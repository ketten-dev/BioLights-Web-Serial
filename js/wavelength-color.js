// Fysisch geïnspireerde, benaderende golflengte→kleur-mapping voor het
// spectrum-paneel. Zichtbaar licht (~380-780nm) volgt de klassieke
// piecewise-lineaire benadering; buiten dat bereik dooft de kleur naar
// zwart (UV onder 380nm, NIR boven 780nm) in plaats van een abrupte rand.

function wavelengthToRgb(nm) {
    let r, g, b;

    if (nm < 380) {
        r = 0.5; g = 0; b = 1;
    } else if (nm < 440) {
        r = -(nm - 440) / (440 - 380); g = 0; b = 1;
    } else if (nm < 490) {
        r = 0; g = (nm - 440) / (490 - 440); b = 1;
    } else if (nm < 510) {
        r = 0; g = 1; b = -(nm - 510) / (510 - 490);
    } else if (nm < 580) {
        r = (nm - 510) / (580 - 510); g = 1; b = 0;
    } else if (nm < 645) {
        r = 1; g = -(nm - 645) / (645 - 580); b = 0;
    } else {
        r = 1; g = 0; b = 0;
    }

    let factor = 1;
    if (nm < 380) {
        factor = 0.3;
    } else if (nm < 420) {
        factor = 0.3 + 0.7 * (nm - 380) / 40;
    } else if (nm > 780) {
        factor = Math.max(0, 1 - (nm - 780) / 220);
    }

    const clamp255 = (c) => Math.max(0, Math.min(255, Math.round(c * factor * 255)));
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b) };
}

function wavelengthToCssColor(nm) {
    const { r, g, b } = wavelengthToRgb(nm);
    return `rgb(${r},${g},${b})`;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { wavelengthToRgb, wavelengthToCssColor };
}
