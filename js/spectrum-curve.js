// Zet gemeten sensor-band-waarden om in één doorlopende golflengte-curve:
// elke band met een bekende golflengte wordt een Gaussiaanse bult (centrum =
// band.wavelength_nm, breedte = band.fwhm_nm omgerekend naar standaarddeviatie
// via de standaard FWHM→sigma-formule), geschaald met de gemeten waarde.
// Alle bulten worden per golflengte opgeteld tot één silhouet. Banden zonder
// golflengte (bv. Clear, Flicker) hebben geen positie op deze as en worden
// overgeslagen.

function computeSpectrumCurve(bands, values, options) {
    const { rangeMin, rangeMax, stepNm } = options;

    const contributors = bands
        .map((band, i) => ({ band, value: values[i] ?? 0 }))
        .filter(c => Number.isFinite(c.band.wavelength_nm) && Number.isFinite(c.band.fwhm_nm) && c.band.fwhm_nm > 0);

    const points = [];
    for (let wl = rangeMin; wl <= rangeMax; wl += stepNm) {
        let intensity = 0;
        for (const c of contributors) {
            const sigma = c.band.fwhm_nm / (2 * Math.sqrt(2 * Math.log(2)));
            const exponent = -((wl - c.band.wavelength_nm) ** 2) / (2 * sigma * sigma);
            intensity += c.value * Math.exp(exponent);
        }
        points.push({ wavelength: wl, intensity });
    }
    return points;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeSpectrumCurve };
}
