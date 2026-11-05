// Parser, validator en fotobiologische safety-checks voor BioLights profielen.
// Ondersteunt:
// 1. Directe JSON, Markdown codeblocks (```json ... ```) en vrije AI-chattekst met JSON erin.
// 2. URL Deep Links (#profile=... of ?profile=...) in zowel URL-encoded JSON als Base64 / Base64URL.
// 3. Normalisatie naar de vaste 6x6 BioLights hardware-matrix (6 kanalen x 6 setpoints) + veiligheidswaarschuwingen.

function extractJsonFromText(input) {
    if (input && typeof input === 'object') {
        return input;
    }
    if (typeof input !== 'string') {
        throw new Error('Profile input must be a JSON string or object.');
    }

    let text = input.trim();
    if (!text) {
        throw new Error('Empty profile input.');
    }

    // 1. Strip markdown code fences (```json ... ``` of ``` ... ```)
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
        text = fenceMatch[1].trim();
    }

    // 2. Probeer direct te parsen
    try {
        return JSON.parse(text);
    } catch (_) {
        // 3. Als er nog conversatietekst omheen staat: zoek het buitenste { ... } blok
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            const candidate = text.slice(firstBrace, lastBrace + 1);
            return JSON.parse(candidate);
        }
        throw new Error('Could not parse valid JSON from input.');
    }
}

function decodeProfileParam(rawParam) {
    if (!rawParam || typeof rawParam !== 'string') {
        throw new Error('Empty profile parameter in URL.');
    }

    let cleaned = rawParam.trim();

    // 1. Probeer eerst URL-decoded tekst (werkt direct voor ?profile=%7B... of #profile={"labels":...})
    try {
        const uriDecoded = decodeURIComponent(cleaned);
        if (uriDecoded.trim().startsWith('{')) {
            return extractJsonFromText(uriDecoded);
        }
        cleaned = uriDecoded.trim();
    } catch (_) {
        // Negeer als decodeURIComponent faalt op ruwe tekens
    }

    if (cleaned.startsWith('{')) {
        return extractJsonFromText(cleaned);
    }

    // 2. Anders: Base64 of Base64URL (vervang '-' door '+' en '_' door '/', vul '=' padding aan)
    let b64 = cleaned.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) {
        b64 += '=';
    }

    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    const utf8Text = new TextDecoder('utf-8').decode(bytes);
    return extractJsonFromText(utf8Text);
}

function validateAndNormalizeProfile(rawInput, fallbackLabels = ['UV', 'Deep Blue', 'Blue', 'White', 'Hyper Red', 'IR']) {
    const obj = extractJsonFromText(rawInput);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new Error('Profile root must be a JSON object.');
    }

    if (!Array.isArray(obj.setpoints) || obj.setpoints.length === 0) {
        throw new Error('Profile is missing a valid "setpoints" array.');
    }

    const warnings = [];
    const infoMessages = [];

    // Labels valideren en aanvullen tot 6 kanalen
    const labels = [];
    if (Array.isArray(obj.labels)) {
        if (obj.labels.length !== 6) {
            warnings.push(`Profile specifies ${obj.labels.length} channel labels; BioLights hardware uses 6 channels (GPIO1-GPIO6). Adjusted to 6 channels.`);
        }
        for (let c = 0; c < 6; c++) {
            const rawLbl = obj.labels[c];
            labels.push((typeof rawLbl === 'string' && rawLbl.trim() !== '') ? rawLbl.trim() : (fallbackLabels[c] || `Ch${c + 1}`));
        }
    } else {
        for (let c = 0; c < 6; c++) {
            labels.push(fallbackLabels[c] || `Ch${c + 1}`);
        }
    }

    // Setpoints valideren
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    const parsedSetpoints = obj.setpoints.map((sp, idx) => {
        if (!sp || typeof sp !== 'object') {
            throw new Error(`Setpoint #${idx + 1} is not an object.`);
        }
        if (typeof sp.time !== 'string' || !timeRegex.test(sp.time.trim())) {
            throw new Error(`Setpoint #${idx + 1} has invalid time "${sp.time}" (expected 24h HH:MM format, e.g. "06:00").`);
        }
        const m = sp.time.trim().match(timeRegex);
        const formattedTime = `${m[1].padStart(2, '0')}:${m[2]}`;

        if (!Array.isArray(sp.values) || sp.values.length === 0) {
            throw new Error(`Setpoint #${idx + 1} (${formattedTime}) is missing a "values" array.`);
        }

        const values = [];
        for (let c = 0; c < 6; c++) {
            const rawVal = sp.values[c];
            let num = (rawVal === undefined || rawVal === null || rawVal === '') ? 0 : Number(rawVal);
            if (!Number.isFinite(num)) {
                throw new Error(`Setpoint #${idx + 1} (${formattedTime}), channel ${c + 1} has a non-numeric value.`);
            }
            num = Math.round(num);
            if (num < 0 || num > 100) {
                warnings.push(`Setpoint ${formattedTime} (${labels[c]}): value ${num}% clamped to 0-100%.`);
                num = Math.max(0, Math.min(100, num));
            }
            values.push(num);
        }

        return { time: formattedTime, values };
    });

    // Normaliseer naar exact 6 setpoints voor de hardware-matrix
    let setpoints = parsedSetpoints.slice(0, 6);
    if (parsedSetpoints.length < 6) {
        warnings.push(`Profile contains ${parsedSetpoints.length} setpoints; padded to 6 rows for the BioLights matrix.`);
        while (setpoints.length < 6) {
            setpoints.push({ time: '00:00', values: [0, 0, 0, 0, 0, 0] });
        }
    } else if (parsedSetpoints.length > 6) {
        warnings.push(`Profile contains ${parsedSetpoints.length} setpoints; truncated to the first 6 setpoints supported by BioLights hardware.`);
    }

    // Metadata uitlezen (indien meegegeven door een LLM)
    if (obj.metadata && typeof obj.metadata === 'object') {
        const metaParts = [];
        if (obj.metadata.crop) metaParts.push(`Crop: ${obj.metadata.crop}`);
        if (obj.metadata.growth_phase) metaParts.push(`Stage: ${obj.metadata.growth_phase}`);
        if (obj.metadata.target_dli !== undefined) metaParts.push(`Target DLI: ${obj.metadata.target_dli} mol/m²/d`);
        if (obj.metadata.photoperiod_hours !== undefined) metaParts.push(`Photoperiod: ${obj.metadata.photoperiod_hours}h`);
        if (metaParts.length > 0) {
            infoMessages.push(`Profile metadata — ${metaParts.join(' | ')}`);
        }
        if (obj.metadata.notes) {
            infoMessages.push(`Profile notes: ${obj.metadata.notes}`);
        }
    }

    // Fotobiologische & hardware safety-guards (adviserend in de terminal)
    const toMins = (t) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    };

    // 1. UV-kanaal check
    labels.forEach((lbl, c) => {
        const clean = lbl.toLowerCase();
        const asWl = Number(clean);
        const isUv = clean.includes('uv') || clean.includes('ultraviolet') || (!Number.isNaN(asWl) && asWl >= 280 && asWl < 400);
        if (isUv) {
            const maxUv = Math.max(...setpoints.map(s => s.values[c]));
            const highCount = setpoints.filter(s => s.values[c] > 15).length;
            if (maxUv > 35) {
                warnings.push(`Safety notice: UV channel (${lbl}) reaches ${maxUv}%. High UV can cause phototoxicity in young plants.`);
            } else if (highCount >= 4) {
                warnings.push(`Safety notice: UV channel (${lbl}) is >15% across ${highCount} setpoints. Verify sustained UV exposure for your crop.`);
            }
        }
    });

    // 2. Slew-rate / thermische overgang check (< 10 min van <=10% naar >=90% of omgekeerd)
    const sorted = setpoints
        .map(sp => ({ time: sp.time, mins: toMins(sp.time), values: sp.values }))
        .sort((a, b) => a.mins - b.mins);

    for (let i = 0; i < sorted.length; i++) {
        const curr = sorted[i];
        const next = sorted[(i + 1) % sorted.length];
        let dt = next.mins - curr.mins;
        if (dt < 0) dt += 1440;
        if (dt > 0 && dt < 10) {
            for (let c = 0; c < 6; c++) {
                const dv = Math.abs(next.values[c] - curr.values[c]);
                if (dv >= 80) {
                    warnings.push(`Slew rate notice: ${labels[c]} jumps by ${dv}% in ${dt} min (${curr.time} -> ${next.time}). Consider >=10 min ramp to reduce LED thermal stress.`);
                    break;
                }
            }
        }
    }

    return {
        labels,
        setpoints,
        metadata: obj.metadata || null,
        infoMessages,
        warnings
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        extractJsonFromText,
        decodeProfileParam,
        validateAndNormalizeProfile
    };
}
