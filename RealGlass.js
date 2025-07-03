import html2canvas from "html2canvas-pro";
import p5 from "p5";

class RealGlass {
  constructor(sourceInstance = null) {
    this.sourceInstance = sourceInstance;
    this.capturedImage = null;
    this.lowResImage = null;
    this.maskTexture = null;
    this.blurredMaskTexture = null;
    this.shaderProgram = null;
    this.p5Instance = null;
    this.p5ImageLoader = null;
    this.resizeDebounceTimer = null;
    this.isInitialized = false;
    this.targetElement = null;
    this.canvasContainer = null;
    this.currentParameters = {};
    this.onclone = () => {};
    this.scrollX = 0;
    this.scrollY = 0;
    this.documentHeight = 0;
    this.documentWidth = 0;
    this.vertexShaderSource = `
precision highp float;

attribute vec3 aPosition;
attribute vec2 aTexCoord;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

varying vec2 vTexCoord;

void main() {
    vTexCoord = aTexCoord;
    
    vec4 viewModelPosition = uModelViewMatrix * vec4(aPosition, 1.0);
    gl_Position = uProjectionMatrix * viewModelPosition;
}`;

    this.fragmentShaderSource = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform sampler2D uLowResTexture;
uniform sampler2D uMaskTexture;
uniform sampler2D uBlurredMaskTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uOffset;
uniform vec2 uScale;
uniform float uChromaticAberration;
uniform sampler2D uFrostedTexture;
uniform float uGlassOpacity;
uniform float uLightStrength;
uniform vec2 uLightPosition;
uniform float uEdgeSmoothness;
uniform float uIOR;
uniform float uBorderRadius;
uniform float uSpecularShininess;
uniform vec2 uCardSize;
uniform float uThickness;
uniform vec3 uTintColor;
uniform float uTintStrength;
uniform float uRotationX;
uniform float uRotationY;
uniform float uRotationZ;
uniform float uScaleTransform;
uniform bool uUseMask;
uniform float uMaskSmoothingInset;

const float AIR_IOR = 1.0;
const float GLASS_THICKNESS_MAX = 0.7;
const float GLASS_THICKNESS_MIN = 0.1;

// Physical wavelengths for chromatic aberration (in micrometers)
const float LAMBDA_RED = 0.650;
const float LAMBDA_GREEN = 0.550;
const float LAMBDA_BLUE = 0.450;
const float LAMBDA_VIOLET = 0.400;

// Crown glass dispersion coefficients (more accurate)
const float CAUCHY_A = 1.5168;
const float CAUCHY_B = 0.00420;

mat3 rotationMatrix(float x, float y, float z) {
    float cx = cos(x);
    float sx = sin(x);
    float cy = cos(y);
    float sy = sin(y);
    float cz = cos(z);
    float sz = sin(z);
    
    mat3 rotX = mat3(1.0, 0.0, 0.0,
                     0.0, cx, -sx,
                     0.0, sx, cx);
    
    mat3 rotY = mat3(cy, 0.0, sy,
                     0.0, 1.0, 0.0,
                     -sy, 0.0, cy);
    
    mat3 rotZ = mat3(cz, -sz, 0.0,
                     sz, cz, 0.0,
                     0.0, 0.0, 1.0);
    
    return rotZ * rotY * rotX;
}

vec3 calculateViewDir() {
    mat3 rotation = rotationMatrix(uRotationX, uRotationY, uRotationZ);
    vec3 baseViewDir = vec3(0.0, 0.0, 1.0);
    return normalize(rotation * baseViewDir);
}

float roundedRectDistance(vec2 uv, vec2 cardSize, float radiusPx) {
    vec2 pixelPos = uv * cardSize;
    vec2 centerPos = cardSize * 0.5;
    
    vec2 halfSize = cardSize * 0.5 - radiusPx;
    vec2 d = abs(pixelPos - centerPos) - halfSize;
    float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radiusPx;
    
    return dist / min(cardSize.x, cardSize.y);
}

float getMaskValue(vec2 uv) {
    if (uUseMask) {
        float maskValue = texture2D(uBlurredMaskTexture, uv).r;
        return floor(maskValue + (1.0 - uMaskSmoothingInset));
    } else {
        float rectDist = roundedRectDistance(uv, uCardSize, uBorderRadius);
        float edgeSmoothnessPx = uEdgeSmoothness / min(uCardSize.x, uCardSize.y);
        return 1.0 - smoothstep(-edgeSmoothnessPx, edgeSmoothnessPx, rectDist);
    }
}

float getEdgeDistance(vec2 uv) {
    if (uUseMask) {
        float maskValue = texture2D(uBlurredMaskTexture, uv).r;
        // Convert mask value to edge distance - 1.0 is center, 0.0 is edge
        return (maskValue - 0.5) * 2.0;
    } else {
        return roundedRectDistance(uv, uCardSize, uBorderRadius);
    }
}

float interpEdgeThickness(float edgeDistance, float radiusPx, vec2 cardSize, vec2 uv) {
    if (uUseMask) {
        // For masks, keep flat surface in center with thickness variation only at edges
        float maskValue = texture2D(uBlurredMaskTexture, uv).r;
        if (maskValue > 0.8) {
            // Center area - keep flat with maximum thickness
            return GLASS_THICKNESS_MAX * uThickness;
        } else {
            // Edge area - vary thickness based on mask edge distance
            float edgeThickness = smoothstep(0.0, 0.8, maskValue);
            return mix(GLASS_THICKNESS_MIN, GLASS_THICKNESS_MAX, edgeThickness) * uThickness;
        }
    } else {
        float normalizedRadius = radiusPx / min(cardSize.x, cardSize.y);
        float edgeInfluence = smoothstep(-normalizedRadius * 0.5, normalizedRadius * 0.5, edgeDistance);
        
        float baseThickness = mix(GLASS_THICKNESS_MIN, GLASS_THICKNESS_MAX, edgeInfluence);
        return baseThickness * uThickness;
    }
}

float fresnel(vec3 normal, vec3 viewDir, float ior) {
    float cosTheta = abs(dot(normal, viewDir));
    float f0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
    return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

vec3 calculateNormal(vec2 uv, float edgeDistance, float thickness, vec2 cardSize) {
    vec3 normal = vec3(0.0, 0.0, 1.0);
    
    if (uUseMask) {
        vec2 texelSize = 1.0 / uCardSize;
        
        // Sample neighboring mask values to calculate the surface gradient
        float left = texture2D(uBlurredMaskTexture, uv - vec2(texelSize.x, 0.0)).r;
        float right = texture2D(uBlurredMaskTexture, uv + vec2(texelSize.x, 0.0)).r;
        float up = texture2D(uBlurredMaskTexture, uv - vec2(0.0, texelSize.y)).r;
        float down = texture2D(uBlurredMaskTexture, uv + vec2(0.0, texelSize.y)).r;
        
        vec2 gradient = vec2(right - left, down - up);

        // **KEY FIX for TIR artifacts**
        // We create a normal from the gradient, but then clamp its xy components.
        // This prevents the normal from becoming too steep, which is what causes
        // the refract() function to fail and produce rainbow artifacts at the edges.
        float strength = 2.0;   // Controls the "height" of the beveled edge
        float max_tilt = 0.7;   // The maximum steepness allowed. Prevents TIR.
        
        vec3 gradient_normal = vec3(gradient * strength, 1.0);
        gradient_normal.xy = clamp(gradient_normal.xy, -max_tilt, max_tilt);

        normal = normalize(gradient_normal);
        
    } else { // Keep original logic for the default rounded rectangle
        vec2 fromCenter = (uv - 0.5) * 2.0;
        float normalizedRadius = uBorderRadius / min(cardSize.x, cardSize.y);
        float edgeInfluence = smoothstep(-normalizedRadius, 0.0, edgeDistance);
        
        if (edgeInfluence > 0.0) {
            vec2 edgeGradient = normalize(fromCenter);
            float curvature = edgeInfluence * thickness * 2.0;
            normal = normalize(vec3(edgeGradient * curvature, 1.0));
        }
    }
    
    // Apply rotation to the final normal
    mat3 rotation = rotationMatrix(uRotationX, uRotationY, uRotationZ);
    normal = normalize(rotation * normal);
    
    return normal;
}

float calculateSpecular(vec3 normal, vec3 viewDir, vec2 lightPos, vec2 fragPos) {
    vec3 lightDir = normalize(vec3(lightPos - fragPos, 0.5));
    vec3 halfwayDir = normalize(lightDir + viewDir);
    float specAngle = max(dot(normal, halfwayDir), 0.0);
    return pow(specAngle, uSpecularShininess);
}



// Accurate Cauchy dispersion formula for glass
float cauchyIOR(float lambda) {
    return CAUCHY_A + CAUCHY_B / (lambda * lambda);
}



float calculateEdgeHighlight(vec2 uv, float edgeDistance, vec2 lightPos, vec2 cardSize, bool isDark) {
    vec2 fromCenter = (uv - 0.5) * 2.0;
    vec2 lightFromCenter = (lightPos - 0.5) * 2.0;
    
    if (isDark) {
        lightFromCenter = -lightFromCenter;
    }
    
    float alignment = dot(normalize(fromCenter), normalize(lightFromCenter));
    
    float normalizedRadius = uBorderRadius / min(cardSize.x, cardSize.y);
    float edgeInfluence = interpEdgeThickness(edgeDistance, uBorderRadius, cardSize, uv);
    float isNearEdge = smoothstep(0.3, 0.8, edgeInfluence);
    
    float highlightWidth = 0.15;
    float highlight = smoothstep(1.0 - highlightWidth, 1.0, alignment) * isNearEdge;
    
    return highlight;
}

void main() {
    vec2 uv = vTexCoord;
    
    // Calculate background UV coordinates based on document-relative position
    vec2 backgroundUV = uOffset + uv * uScale;
    
    // Clamp the background UV coordinates to valid range
    backgroundUV = clamp(backgroundUV, 0.0, 1.0);
    
    float mask = getMaskValue(uv);
    float edgeDistance = getEdgeDistance(uv);
    
    float thickness = interpEdgeThickness(edgeDistance, uBorderRadius, uCardSize, uv);
    vec3 surfaceNormal = calculateNormal(uv, edgeDistance, thickness, uCardSize);
    vec3 viewDir = calculateViewDir();
    
    // Base refraction using the main IOR (always present)
    float baseIORRatio = AIR_IOR / uIOR;
    vec3 baseRefractDir = refract(-viewDir, surfaceNormal, baseIORRatio);
    vec2 baseDisplacement = baseRefractDir.xy * thickness * 0.1;
    
    // Enhanced chromatic aberration with wavelength-dependent dispersion
    float distanceFromCenter = length(uv - 0.5);
    float aberrationStrength = uChromaticAberration * (0.3 + distanceFromCenter * 0.7);
    
    // Calculate wavelength-specific IOR values using Cauchy dispersion
    float iorRed = uIOR + (cauchyIOR(LAMBDA_RED) - CAUCHY_A) * aberrationStrength;
    float iorGreen = uIOR + (cauchyIOR(LAMBDA_GREEN) - CAUCHY_A) * aberrationStrength;
    float iorBlue = uIOR + (cauchyIOR(LAMBDA_BLUE) - CAUCHY_A) * aberrationStrength;
    float iorViolet = uIOR + (cauchyIOR(LAMBDA_VIOLET) - CAUCHY_A) * aberrationStrength;
    
    float iorRatioR = AIR_IOR / iorRed;
    float iorRatioG = AIR_IOR / iorGreen;
    float iorRatioB = AIR_IOR / iorBlue;
    float iorRatioV = AIR_IOR / iorViolet;
    
    vec3 refractDirR = refract(-viewDir, surfaceNormal, iorRatioR);
    vec3 refractDirG = refract(-viewDir, surfaceNormal, iorRatioG);
    vec3 refractDirB = refract(-viewDir, surfaceNormal, iorRatioB);
    vec3 refractDirV = refract(-viewDir, surfaceNormal, iorRatioV);
    
    // Combine base displacement with chromatic aberration
    vec2 displacementR = baseDisplacement + (refractDirR.xy - baseRefractDir.xy) * thickness * 0.15;
    vec2 displacementG = baseDisplacement + (refractDirG.xy - baseRefractDir.xy) * thickness * 0.15;
    vec2 displacementB = baseDisplacement + (refractDirB.xy - baseRefractDir.xy) * thickness * 0.15;
    vec2 displacementV = baseDisplacement + (refractDirV.xy - baseRefractDir.xy) * thickness * 0.15;
    
    vec2 uvR = clamp(backgroundUV + displacementR, 0.0, 1.0);
    vec2 uvG = clamp(backgroundUV + displacementG, 0.0, 1.0);
    vec2 uvB = clamp(backgroundUV + displacementB, 0.0, 1.0);
    vec2 uvV = clamp(backgroundUV + displacementV, 0.0, 1.0);
    
    // Sample refracted colors (frosting is pre-processed in JavaScript)
    vec3 colorR = texture2D(uFrostedTexture, uvR).rgb;
    vec3 colorG = texture2D(uFrostedTexture, uvG).rgb;
    vec3 colorB = texture2D(uFrostedTexture, uvB).rgb;
    
    float r = colorR.r;
    float g = colorG.g;
    float b = colorB.b;
    
    vec3 refractedColor = vec3(r, g, b);
    refractedColor = mix(refractedColor, vec3(1.0), uGlassOpacity * 0.5);
    
    // Simple fresnel-based reflections
    float fresnelAmount = fresnel(surfaceNormal, viewDir, uIOR);
    vec3 reflectedColor = mix(refractedColor, vec3(0.9, 0.95, 1.0), fresnelAmount * 0.2);
    
    // Calculate specular highlight
    vec2 fragPos = backgroundUV;
    float specularHighlight = calculateSpecular(surfaceNormal, viewDir, uLightPosition, fragPos);
    
    // Edge highlights
    float lightHighlight = calculateEdgeHighlight(uv, edgeDistance, uLightPosition, uCardSize, false);
    float darkHighlight = calculateEdgeHighlight(uv, edgeDistance, uLightPosition, uCardSize, true);
    
    vec3 finalColor = reflectedColor;
    
    // Add specular highlights
    vec3 specularColor = vec3(1.0, 0.95, 0.9);
    float specularAmount = specularHighlight * uLightStrength * 0.3;
    finalColor = mix(finalColor, specularColor, specularAmount);
    
    // Edge lighting effects
    vec3 lightTint = mix(finalColor, vec3(0.95, 0.98, 1.0), 0.7);
    vec3 darkTint = finalColor * 0.3;
    
    finalColor = mix(finalColor, lightTint, lightHighlight * uLightStrength * 0.3);
    finalColor = mix(finalColor, darkTint, darkHighlight * uLightStrength * 0.15);
    
    // Apply tint
    finalColor = mix(finalColor, finalColor * uTintColor, uTintStrength);

    float finalAlpha = mask * (0.8 + uGlassOpacity * 0.2);
    
    gl_FragColor = vec4(finalColor * mask, finalAlpha);
}`;
  }

  async init(options = {}) {
    if (this.isInitialized) return;

    const { ignoreElements = [] } = options;

    if (this.sourceInstance) {
      this.capturedImage = this.sourceInstance.capturedImage;
      this.lowResImage = this.sourceInstance.lowResImage;
      this.p5ImageLoader = this.sourceInstance.p5ImageLoader;
      this.documentWidth = this.sourceInstance.documentWidth;
      this.documentHeight = this.sourceInstance.documentHeight;
    } else {
      this.createImageLoader();
      await this.captureBackground(ignoreElements);
    }
    this.setupResizeListener();

    this.isInitialized = true;
  }

  createImageLoader() {
    const sketch = (p) => {
      p.setup = () => {
        p.createCanvas(1, 1);
      };
    };
    this.p5ImageLoader = new p5(sketch);
  }

  async captureBackground(ignoreElements = []) {
    try {
      // Get full document dimensions
      const body = document.body;
      const html = document.documentElement;
      this.documentHeight = Math.max(
        body.scrollHeight,
        body.offsetHeight,
        html.clientHeight,
        html.scrollHeight,
        html.offsetHeight
      );
      this.documentWidth = Math.max(
        body.scrollWidth,
        body.offsetWidth,
        html.clientWidth,
        html.scrollWidth,
        html.offsetWidth
      );

      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        width: this.documentWidth,
        height: this.documentHeight,
        scale: window.devicePixelRatio,
        ignoreElements: (element) => {
          return ignoreElements.includes(element);
        },
        onclone: this.onclone,
      });

      const dataURL = canvas.toDataURL("image/png");
      this.capturedImage = await this.loadImageFromDataURL(dataURL);
      this.lowResImage = await this.createBlurredVersion(canvas);
    } catch (error) {
      console.error("Failed to capture background:", error);
    }
  }

  async createBlurredVersion(originalCanvas) {
    const scale = 0.25;
    const blurredCanvas = document.createElement("canvas");
    blurredCanvas.width = originalCanvas.width * scale;
    blurredCanvas.height = originalCanvas.height * scale;

    const ctx = blurredCanvas.getContext("2d");
    ctx.filter = "blur(8px)";
    ctx.drawImage(
      originalCanvas,
      0,
      0,
      blurredCanvas.width,
      blurredCanvas.height
    );

    return this.loadImageFromDataURL(blurredCanvas.toDataURL("image/png"));
  }

  async loadMaskFromImage(imageSource) {
    let image;

    if (typeof imageSource === "string") {
      image = await this.loadImageFromDataURL(imageSource);
    } else if (imageSource instanceof HTMLImageElement) {
      const canvas = document.createElement("canvas");
      canvas.width = imageSource.naturalWidth;
      canvas.height = imageSource.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(imageSource, 0, 0);
      image = await this.loadImageFromDataURL(canvas.toDataURL("image/png"));
    } else if (imageSource instanceof HTMLCanvasElement) {
      image = await this.loadImageFromDataURL(
        imageSource.toDataURL("image/png")
      );
    } else {
      throw new Error("Unsupported image source type");
    }

    // Process the canvas of the loaded p5.Image to invert the mask
    const canvas = image.canvas;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]; // Get the original alpha (0-255)
      // Invert: transparent (0) -> white (255), opaque (255) -> black (0)
      const invertedAlpha = alpha;
      data[i] = invertedAlpha; // R
      data[i + 1] = invertedAlpha; // G
      data[i + 2] = invertedAlpha; // B
      data[i + 3] = 255; // Set alpha to full so the texture is opaque
    }
    ctx.putImageData(imageData, 0, 0);

    // Create a new p5.Image from the modified canvas data to ensure texture updates
    const modifiedDataURL = canvas.toDataURL("image/png");
    return this.loadImageFromDataURL(modifiedDataURL);
  }

  async loadMaskFromElement(element) {
    try {
      const canvas = await html2canvas(element, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        scale: 1,
      });

      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      const ctx = maskCanvas.getContext("2d");

      ctx.drawImage(canvas, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3]; // Get the original alpha (0-255)
          // Invert: transparent (0) -> white (255), opaque (255) -> black (0)
          const invertedAlpha = alpha;
          data[i] = invertedAlpha; // R
          data[i + 1] = invertedAlpha; // G
          data[i + 2] = invertedAlpha; // B
          data[i + 3] = 255; // Set alpha to full so the texture is opaque
        }
      }
      ctx.putImageData(imageData, 0, 0);
      return this.loadImageFromDataURL(maskCanvas.toDataURL("image/png"));
    } catch (error) {
      console.error("Failed to create mask from element:", error);
      throw error;
    }
  }

  async createBlurredMask(maskImage, blurRadius = 10) {
    if (!maskImage || !this.p5ImageLoader) return null;

    const canvas = document.createElement("canvas");
    canvas.width = maskImage.width;
    canvas.height = maskImage.height;
    const ctx = canvas.getContext("2d");

    // Apply blur filter
    ctx.filter = `blur(${blurRadius}px)`;
    ctx.drawImage(maskImage.canvas, 0, 0);

    return this.loadImageFromDataURL(canvas.toDataURL("image/png"));
  }

  async createFrostedTexture(sourceImage, blurRadius = 0) {
    if (!sourceImage || blurRadius <= 0) return sourceImage;

    const canvas = document.createElement("canvas");
    canvas.width = sourceImage.width;
    canvas.height = sourceImage.height;
    const ctx = canvas.getContext("2d");

    // Apply blur filter for frosting effect
    ctx.filter = `blur(${blurRadius}px)`;
    ctx.drawImage(sourceImage.canvas, 0, 0);

    return this.loadImageFromDataURL(canvas.toDataURL("image/png"));
  }

  loadImageFromDataURL(dataURL) {
    return new Promise((resolve, reject) => {
      if (!this.p5ImageLoader) {
        reject(new Error("p5 image loader not initialized"));
        return;
      }

      const img = this.p5ImageLoader.loadImage(
        dataURL,
        (loadedImage) => {
          resolve(loadedImage);
        },
        (error) => {
          reject(error);
        }
      );
    });
  }

  setupResizeListener() {
    const debouncedResize = () => {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = setTimeout(async () => {
        await this.captureBackground();
        if (this.targetElement) {
          await this.apply(this.targetElement, this.currentParameters);
        }
      }, 300);
    };

    window.addEventListener("resize", debouncedResize);

    // Add scroll listener
    window.addEventListener("scroll", () => {
      this.scrollX = window.scrollX;
      this.scrollY = window.scrollY;
    });
  }

  async apply(element, parameters = {}) {
    if (!this.isInitialized) {
      console.error("RealGlass must be initialized before applying");
      return;
    }

    this.targetElement = element;
    this.currentParameters = parameters;
    const rect = element.getBoundingClientRect();

    // Process mask if provided
    let maskWidth = rect.width;
    let maskHeight = rect.height;
    let useMask = false;

    if (parameters.maskImage || parameters.maskElement) {
      try {
        if (parameters.maskElement) {
          this.maskTexture = await this.loadMaskFromElement(
            parameters.maskElement
          );
        } else if (parameters.maskImage) {
          this.maskTexture = await this.loadMaskFromImage(parameters.maskImage);
        }

        if (this.maskTexture) {
          const blurRadius = parameters.maskSmoothing
            ? parameters.maskSmoothing * 20
            : 10;
          this.blurredMaskTexture = await this.createBlurredMask(
            this.maskTexture,
            blurRadius
          );
          useMask = true;
        }
      } catch (error) {
        console.error("Failed to load mask:", error);
      }
    }

    // Create frosted texture (always create one, even if frosting is 0)
    let frostedTexture;
    try {
      if (parameters.frosting && parameters.frosting > 0) {
        const frostingRadius = Math.max(1, parameters.frosting * 20); // Scale frosting value to pixel radius (1-20px)
        frostedTexture = await this.createFrostedTexture(
          this.capturedImage,
          frostingRadius
        );
      } else {
        frostedTexture = this.capturedImage; // No frosting, use original
      }
    } catch (error) {
      console.error("Failed to create frosted texture:", error);
      frostedTexture = this.capturedImage;
    }

    const config = {
      width: maskWidth,
      height: maskHeight,
      chromaticAberration: 0.5,
      frosting: 0,
      glassOpacity: 0.0,
      lightStrength: 2.175,
      lightX: 0.7,
      lightY: 0.3,
      edgeSmoothness: 2.0,
      ior: 1.52,
      borderRadius: 50,
      specularShininess: 32,
      thickness: 1.0,
      rotationX: 0.0,
      rotationY: 0.0,
      rotationZ: 0.0,
      scaleTransform: 1.0,
      tintColor: [1.0, 1.0, 1.0],
      tintStrength: 0.0,
      useMask: useMask,
      maskSmoothing: 0.15,
      maskSmoothingInset: 0.1,
      ...parameters,
    };

    // Convert tintColor if it's a hex string
    if (
      typeof config.tintColor === "string" &&
      config.tintColor.startsWith("#")
    ) {
      const hex = config.tintColor;
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      config.tintColor = [r, g, b];
    }

    element.setAttribute("data-html2canvas-ignore", "true");
    await new Promise((resolve) => setTimeout(resolve, 1));
    // Make element transparent so canvas shows through
    element.style.background = "transparent";
    element.style.borderRadius = `${config.borderRadius}px`;

    // Create canvas container positioned behind element
    if (this.canvasContainer) {
      this.canvasContainer.remove();
    }

    const Z_INDEX = 1000;
    this.canvasContainer = document.createElement("div");
    this.canvasContainer.setAttribute("data-html2canvas-ignore", "true");

    // Match positioning of the target element
    const elementStyle = window.getComputedStyle(element);
    if (elementStyle.position === "fixed") {
      this.canvasContainer.style.position = "fixed";
    } else {
      this.canvasContainer.style.position = "absolute";
    }

    this.canvasContainer.style.left = `${rect.left}px`;
    this.canvasContainer.style.top = `${rect.top}px`;
    this.canvasContainer.style.width = `${config.width}px`;
    this.canvasContainer.style.height = `${config.height}px`;
    this.canvasContainer.style.borderRadius = `${config.borderRadius}px`;
    this.canvasContainer.style.overflow = "hidden";
    this.canvasContainer.style.zIndex = Z_INDEX - 1;
    element.style.zIndex = Z_INDEX;
    this.canvasContainer.style.pointerEvents = "none";

    document.body.appendChild(this.canvasContainer);

    if (this.p5Instance) {
      this.p5Instance.remove();
    }

    const sketch = (p) => {
      p.setup = () => {
        p.createCanvas(config.width, config.height, p.WEBGL);
        p.noStroke();

        this.shaderProgram = p.createShader(
          this.vertexShaderSource,
          this.fragmentShaderSource
        );
      };

      p.draw = () => {
        if (
          !this.capturedImage ||
          !this.lowResImage ||
          !this.shaderProgram ||
          !frostedTexture
        )
          return;

        // Update canvas position to follow element
        let currentRect = element.getBoundingClientRect();

        // Calculate offsets including scroll position
        const elementStyle = window.getComputedStyle(element);
        const isFixed = elementStyle.position === "fixed";

        this.canvasContainer.style.top = `${
          currentRect.top + (!isFixed ? this.scrollY : 0)
        }px`;
        this.canvasContainer.style.left = `${
          currentRect.left + (!isFixed ? this.scrollX : 0)
        }px`;

        // For all elements, use document-relative position with scroll to correctly
        // map the background from the full-page canvas capture.
        const offsetX = (currentRect.left + this.scrollX) / this.documentWidth;
        const offsetY = (currentRect.top + this.scrollY) / this.documentHeight;

        const scaleX = config.width / this.documentWidth;
        const scaleY = config.height / this.documentHeight;

        p.shader(this.shaderProgram);

        this.shaderProgram.setUniform("uTexture", this.capturedImage);
        this.shaderProgram.setUniform("uLowResTexture", this.lowResImage);
        this.shaderProgram.setUniform("uFrostedTexture", frostedTexture);

        if (config.useMask && this.maskTexture && this.blurredMaskTexture) {
          this.shaderProgram.setUniform("uMaskTexture", this.maskTexture);
          this.shaderProgram.setUniform(
            "uBlurredMaskTexture",
            this.blurredMaskTexture
          );
        } else {
          this.shaderProgram.setUniform("uMaskTexture", this.capturedImage);
          this.shaderProgram.setUniform(
            "uBlurredMaskTexture",
            this.capturedImage
          );
        }

        this.shaderProgram.setUniform("uResolution", [p.width, p.height]);
        this.shaderProgram.setUniform("uTime", 0);
        this.shaderProgram.setUniform("uOffset", [offsetX, offsetY]);
        this.shaderProgram.setUniform("uScale", [scaleX, scaleY]);
        this.shaderProgram.setUniform(
          "uChromaticAberration",
          config.chromaticAberration
        );
        this.shaderProgram.setUniform("uGlassOpacity", config.glassOpacity);
        this.shaderProgram.setUniform("uLightStrength", config.lightStrength);
        this.shaderProgram.setUniform("uLightPosition", [
          config.lightX,
          config.lightY,
        ]);
        this.shaderProgram.setUniform("uEdgeSmoothness", config.edgeSmoothness);
        this.shaderProgram.setUniform("uIOR", config.ior);
        this.shaderProgram.setUniform("uBorderRadius", config.borderRadius);
        this.shaderProgram.setUniform(
          "uSpecularShininess",
          config.specularShininess
        );
        this.shaderProgram.setUniform("uCardSize", [
          config.width,
          config.height,
        ]);
        this.shaderProgram.setUniform("uThickness", config.thickness);
        this.shaderProgram.setUniform("uTintColor", config.tintColor);
        this.shaderProgram.setUniform("uTintStrength", config.tintStrength);
        this.shaderProgram.setUniform("uRotationX", config.rotationX);
        this.shaderProgram.setUniform("uRotationY", config.rotationY);
        this.shaderProgram.setUniform("uRotationZ", config.rotationZ);
        this.shaderProgram.setUniform("uScaleTransform", config.scaleTransform);
        this.shaderProgram.setUniform("uUseMask", config.useMask);
        this.shaderProgram.setUniform(
          "uMaskSmoothingInset",
          config.maskSmoothingInset
        );

        p.plane(config.width, config.height);
      };
    };

    this.p5Instance = new p5(sketch, this.canvasContainer);
    return this.p5Instance;
  }

  destroy() {
    if (this.p5Instance) {
      this.p5Instance.remove();
      this.p5Instance = null;
    }

    if (this.canvasContainer) {
      this.canvasContainer.remove();
      this.canvasContainer = null;
    }

    // Clean up mask textures
    if (this.maskTexture) {
      this.maskTexture.remove();
      this.maskTexture = null;
    }

    if (this.blurredMaskTexture) {
      this.blurredMaskTexture.remove();
      this.blurredMaskTexture = null;
    }

    // Only clean up shared resources if this isn't using a source instance
    if (!this.sourceInstance) {
      if (this.p5ImageLoader) {
        this.p5ImageLoader.remove();
        this.p5ImageLoader = null;
      }

      if (this.capturedImage) {
        this.capturedImage.remove();
        this.capturedImage = null;
      }

      if (this.lowResImage) {
        this.lowResImage.remove();
        this.lowResImage = null;
      }

      clearTimeout(this.resizeDebounceTimer);
    }

    this.isInitialized = false;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = RealGlass;
}

if (typeof window !== "undefined") {
  window.RealGlass = RealGlass;
}
