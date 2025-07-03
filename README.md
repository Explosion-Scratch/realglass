<img width="1000" alt="image" src="https://github.com/user-attachments/assets/697d4d4a-ee17-4604-b5cb-fa861d93a2e3" />

<img height="220" alt="image" src="https://github.com/user-attachments/assets/bdcb1d54-b911-4680-8f48-71274b3ce850" />
<img height="220" alt="image" src="https://github.com/user-attachments/assets/972dada1-2439-4a89-9ca6-f3c2b9dcdae4" />
<img height="220" alt="image" src="https://github.com/user-attachments/assets/a4382a5c-14ef-4187-b736-f419672cae52" />






<br/>
<div align=center><a href="https://real-glass.vercel.app"><i>Demo</i></a></div>

# RealGlass - A Modern Glassmorphism Library

Create realistic glass using HTML + CSS + JS

## How to Use

### 1. Include the library

CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/realglass/RealGlass.standalone.js"></script>
```

### 2. Apply the effect

```javascript
const myElement = document.getElementById('my-glass-element');

const realGlass = new RealGlass();

// The init call screenshots the page and sets up listeners for resize
await realGlass.init();

// Apply the effect with custom options
await realGlass.apply(myElement, {
  frosting: 0.2,
  borderRadius: 20,
  lightStrength: 1.8,
  // ... and many more options
});

// To create another instance, pass in the first one as an argument, 
// this way it screenshots the page once and reuses the same image for all instances
/*
const anotherRealGlass = new RealGlass(realGlass);
await anotherRealGlass.init();
await anotherRealGlass.apply(myElement, {
  frosting: 0.2,
  borderRadius: 20,
  lightStrength: 1.8,
  // ... and many more options
});
*/
```

## Configuration Options

| Parameter | Description | Default |
| :--- | :--- | :--- |
| `frosting` | Controls the blurriness of the background. 0 is clear, 1 is heavily blurred. | `0` |
| `chromaticAberration` | The amount of color fringing, simulating lens dispersion. | `0.5` |
| `glassOpacity` | The opacity of the glass layer itself (0 to 1). | `0.0` |
| `lightStrength` | Intensity of the specular and edge lighting. | `2.175` |
| `lightX` / `lightY` | Normalized position of the light source (0 to 1). | `0.7` / `0.3` |
| `edgeSmoothness` | How soft the edges of the glass shape are. | `2.0` |
| `ior` | Index of Refraction. Controls how much light bends. | `1.52` |
| `borderRadius` | The corner radius of the glass shape in pixels. | `50` |
| `specularShininess` | Controls the size and intensity of the specular highlight. | `32` |
| `thickness` | Simulates the thickness of the glass, affecting refraction. | `1.0` |
| `tintColor` | Color to tint the glass. Can be a hex string or `[r, g, b]` array. | `[1, 1, 1]` |
| `tintStrength` | The strength of the tint color (0 to 1). | `0.0` |
| `useMask` | Set to `true` to use a custom mask instead of a rounded rectangle. | `false` |
| `maskImage` | An image or canvas element to use as a mask. | `null` |
| `maskElement` | An HTML element to generate a mask from. | `null` |
| `maskSmoothing` | Controls the blur radius applied to the mask for softer edges. | `0.15` |
