// Parser, validator en fotobiologische safety-checks voor BioLights profielen.
// Ondersteunt:
// 1. Compacte éénregelige commando-syntax voor het Raw Command veld:
//    - PROFILE|06:00,0,0,0,0,0,0|08:00,0,30,40,50,45,5|...|LABELS,UV,Deep Blue,Blue,White,Hyper Red,IR
//    - of het native protocolformaat: SYNC|<mins>|360,0,0,0,0,0,0|...|LABELS,...
//    - of met tijd in HH:MM én minuten door elkaar.
// 2. Directe JSON, Markdown codeblocks (```json ... ```), vrije AI-chattekst met JSON erin,
//    én veelvoorkomende door LLM's verzonnen JSON-wrappers (zoals {"cmd":"load_recipe","data":{"setpoints":[{"time":"07:00","gpio1":0,...}]}}).
// 3. Intelligente reductie van >6 setpoints naar exact 6 representatieve setpoints (verwijdert redundante 0%-punten en vlakke tussenpunten).
// 4. URL Deep Links (#profile=... of ?profile=...) in zowel pipe-command syntax, URL-encoded JSON als Base64 / Base64URL.

function isPipeProfileCommand(input) {
    if (typeof input !== 'string') return false;
    const trimmed = input.trim();
    return /^(PROFILE|RECIPE|PREVIEW|LOAD|SYNC|STATE)\|/i.test(trimmed);
}

function parsePipeProfileCommand(line, fallbackLabels = ['UV', 'Deep Blue', 'Blue', 'White', 'Hyper Red', 'IR']) {
    const parts = line.trim().split('|').map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) {
        throw new Error('Invalid command format. Expected: PROFILE|06:00,0,0,0,0,0,0|...|LABELS,UV,Deep Blue,Blue,White,Hyper Red,IR');
    }

    const labels = [...fallbackLabels];
    let hasExplicitLabels = false;
    const setpoints = [];
    const metadata = {};

    for (let i = 1; i < parts.length; i++) {
        const seg = parts[i];
        const upper = seg.toUpperCase();

        if (upper.startsWith('LABELS,') || upper.startsWith('LABELS:')) {
            const rawLabels = seg.slice(7).split(',');
            hasExplicitLabels = true;
            for (let c = 0; c < 6; c++) {
                if (rawLabels[c] !== undefined && rawLabels[c].trim() !== '') {
                    labels[c] = rawLabels[c].trim();
                }
            }
            continue;
        }

        if (upper.startsWith('TIME,')) {
            continue; // Negeer losse TIME,<mins> uit een STATE|-regel bij preview-inladen
        }

        if (upper.startsWith('CROP,') || upper.startsWith('CROP:')) {
            metadata.crop = seg.slice(5).trim();
            continue;
        }

        if (upper.startsWith('NOTE,') || upper.startsWith('NOTE:') || upper.startsWith('NOTES,') || upper.startsWith('NOTES:')) {
            metadata.notes = seg.slice(seg.indexOf(',') !== -1 ? seg.indexOf(',') + 1 : seg.indexOf(':') + 1).trim();
            continue;
        }

        const tokens = seg.split(',').map(t => t.trim());
        // Als het het eerste blok na SYNC| is en slechts 1 getal bevat (systeemtijd in minuten, bv. SYNC|720|...), sla die over
        if (i === 1 && tokens.length === 1 && /^\d+$/.test(tokens[0])) {
            continue;
        }

        if (tokens.length >= 7) {
            const timeToken = tokens[0];
            let formattedTime = null;

            if (/^([0-1]?\d|2[0-3]):([0-5]\d)$/.test(timeToken)) {
                const [hh, mm] = timeToken.split(':');
                formattedTime = `${hh.padStart(2, '0')}:${mm}`;
            } else if (/^\d+$/.test(timeToken)) {
                const totalMins = Math.max(0, Math.min(1439, parseInt(timeToken, 10)));
                const hh = String(Math.floor(totalMins / 60)).padStart(2, '0');
                const mm = String(totalMins % 60).padStart(2, '0');
                formattedTime = `${hh}:${mm}`;
            } else {
                throw new Error(`Invalid time "${timeToken}" in segment "${seg}". Use HH:MM (e.g. 06:00) or minutes (0-1439).`);
            }

            const values = [];
            for (let c = 0; c < 6; c++) {
                const v = Number(tokens[c + 1]);
                if (!Number.isFinite(v)) {
                    throw new Error(`Invalid channel value "${tokens[c + 1]}" at ${formattedTime}.`);
                }
                values.push(Math.round(v));
            }
            setpoints.push({ time: formattedTime, values });
        }
    }

    if (setpoints.length === 0) {
        throw new Error('No valid setpoints found in command. Expected segments like |06:00,0,0,0,0,0,0|.');
    }

    const result = { setpoints };
    if (hasExplicitLabels) {
        result.labels = labels;
    }
    if (Object.keys(metadata).length > 0) {
        result.metadata = metadata;
    }
    return result;
}

function formatProfileCommand(labels, setpoints) {
    const spSegments = setpoints.map(sp => `${sp.time},${sp.values.join(',')}`).join('|');
    return `PROFILE|${spSegments}|LABELS,${labels.join(',')}`;
}

function extractJsonFromText(input, fallbackLabels) {
    if (input && typeof input === 'object') {
        return input;
    }
    if (typeof input !== 'string') {
        throw new Error('Profile input must be a command string, JSON string, or object.');
    }

    let text = input.trim();
    if (!text) {
        throw new Error('Empty profile input.');
    }

    // 1. Strip markdown code fences (```json ... ``` of ``` ... ```)
    const fenceMatch = text.match(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/);
    if (fenceMatch && fenceMatch[1]) {
        text = fenceMatch[1].trim();
    }

    // 2. Check of de tekst een PROFILE|... of SYNC|... commando bevat
    if (isPipeProfileCommand(text)) {
        return parsePipeProfileCommand(text, fallbackLabels);
    }
    const pipeLineMatch = text.match(/(?:^|\n)\s*((?:PROFILE|RECIPE|PREVIEW|SYNC)\s*\|[^\r\n]+)/i);
    if (pipeLineMatch && pipeLineMatch[1]) {
        return parsePipeProfileCommand(pipeLineMatch[1].trim(), fallbackLabels);
    }

    // 3. Probeer direct als JSON te parsen
    try {
        return JSON.parse(text);
    } catch (_) {
        // 4. Als er nog conversatietekst omheen staat: zoek het buitenste { ... } blok
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            const candidate = text.slice(firstBrace, lastBrace + 1);
            return JSON.parse(candidate);
        }
        throw new Error('Could not parse valid PROFILE| command or JSON from input.');
    }
}

function decodeProfileParam(rawParam, fallbackLabels) {
    if (!rawParam || typeof rawParam !== 'string') {
        throw new Error('Empty profile parameter in URL.');
    }

    let cleaned = rawParam.trim();

    // 1. Probeer eerst URL-decoded tekst (werkt direct voor #profile=PROFILE|... of #profile=%7B...)
    try {
        const uriDecoded = decodeURIComponent(cleaned).trim();
        if (uriDecoded.startsWith('{') || isPipeProfileCommand(uriDecoded)) {
            return extractJsonFromText(uriDecoded, fallbackLabels);
        }
        cleaned = uriDecoded;
    } catch (_) {
        // Negeer als decodeURIComponent faalt op ruwe tekens
    }

    if (cleaned.startsWith('{') || isPipeProfileCommand(cleaned)) {
        return extractJsonFromText(cleaned, fallbackLabels);
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
    return extractJsonFromText(utf8Text, fallbackLabels);
}

// Haalt 6 kanaalwaarden uit een setpoint-object, ongeacht of de LLM:
// - een "values": [v1..v6] array geeft, of
// - losse sleutels {"gpio1": 20, "gpio2": 5, ...} of {"ch1": ..., "ch2": ...} of {"UV": ..., "Deep Blue": ...} gebruikt.
function extractSetpointValues(sp, labels) {
    if (Array.isArray(sp.values) && sp.values.length > 0) {
        return sp.values;
    }
    if (Array.isArray(sp.channels) && sp.channels.length > 0) {
        return sp.channels;
    }
    if (Array.isArray(sp.duty) && sp.duty.length > 0) {
        return sp.duty;
    }

    const keys = Object.keys(sp);
    // Check op gpio1..gpio6 of ch1..ch6 of channel1..channel6 (1-indexed) of ch0..ch5 (0-indexed)
    const hasGpio1 = keys.some(k => /^(gpio|ch|channel|pwm)_?[1-6]$/i.test(k));
    if (hasGpio1) {
        const vals = [];
        for (let c = 1; c <= 6; c++) {
            const matchKey = keys.find(k => new RegExp(`^(gpio|ch|channel|pwm)_?${c}$`, 'i').test(k));
            vals.push(matchKey !== undefined ? sp[matchKey] : 0);
        }
        return vals;
    }

    const hasGpio0 = keys.some(k => /^(gpio|ch|channel|pwm)_?0$/i.test(k));
    if (hasGpio0) {
        const vals = [];
        for (let c = 0; c < 6; c++) {
            const matchKey = keys.find(k => new RegExp(`^(gpio|ch|channel|pwm)_?${c}$`, 'i').test(k));
            vals.push(matchKey !== undefined ? sp[matchKey] : 0);
        }
        return vals;
    }

    // Check op kanaalnamen als sleutels (bv. {"uv": 0, "deep_blue": 30, ...})
    const labelAliases = [
        ['uv', 'ultraviolet'],
        ['deep_blue', 'deepblue', 'deep blue'],
        ['blue'],
        ['white', 'full_spectrum'],
        ['hyper_red', 'hyperred', 'hyper red', 'red', 'deep_red'],
        ['ir', 'far_red', 'farred', 'far red', 'infrared']
    ];
    const hasNamedChannel = keys.some(k => {
        const lk = k.toLowerCase();
        return labels.some(l => l.toLowerCase() === lk) || labelAliases.some(group => group.includes(lk));
    });
    if (hasNamedChannel) {
        return labels.map((lbl, c) => {
            const target = lbl.toLowerCase();
            let foundKey = keys.find(k => k.toLowerCase() === target);
            if (!foundKey && labelAliases[c]) {
                foundKey = keys.find(k => labelAliases[c].includes(k.toLowerCase()));
            }
            return foundKey !== undefined ? sp[foundKey] : 0;
        });
    }

    return null;
}

// Als een LLM meer dan 6 setpoints genereert (bijv. 10 setpoints met 00:00 én 07:00 én 20:15 op 0%),
// comprimeer deze dan slim naar de 6 belangrijkste knikpunten van de 24-uurs curve i.p.v. blind afkappen.
function reduceToSixSetpoints(setpoints) {
    if (setpoints.length <= 6) return setpoints;

    const toMins = (t) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    };
    const isAllZero = (v) => v.every(x => x === 0);
    const sameValues = (a, b) => a.every((x, i) => x === b[i]);

    // 1. Sorteer chronologisch op tijd
    let list = setpoints
        .map(sp => ({ time: sp.time, mins: toMins(sp.time), values: [...sp.values] }))
        .sort((a, b) => a.mins - b.mins);

    // 2. Als er meerdere opeenvolgende 0%-setpoints zijn (inclusief wrap-around over middernacht,
    // zoals 00:00=0%, 07:00=0% en 20:15=0%), behoud dan alleen het LAATSTE 0%-punt vóór zonsopkomst (bijv. 07:00)
    // en het EERSTE 0%-punt bij zonsondergang (bijv. 20:15).
    const nonZeroIndices = list.map((sp, i) => (!isAllZero(sp.values) ? i : -1)).filter(i => i !== -1);
    if (nonZeroIndices.length > 0 && list.length > 6) {
        const firstActive = nonZeroIndices[0];
        const lastActive = nonZeroIndices[nonZeroIndices.length - 1];
        const sunriseZeroIdx = firstActive > 0 ? firstActive - 1 : -1;
        const sunsetZeroIdx = lastActive < list.length - 1 ? lastActive + 1 : -1;

        list = list.filter((sp, idx) => {
            if (!isAllZero(sp.values)) return true;
            if (idx === sunriseZeroIdx || idx === sunsetZeroIdx) return true;
            // Ook een middernacht-0% tussen twee actieve punten binnen de dag behouden als die bestaat
            if (idx > firstActive && idx < lastActive) return true;
            return false;
        });
    }

    // 3. Als we nog steeds > 6 punten hebben: verwijder herhaalde identieke waarden of het punt
    // dat het minst afwijkt van lineaire interpolatie tussen zijn directe buren (Ramer-Douglas-Peucker op 24u).
    while (list.length > 6) {
        let minScore = Infinity;
        let removeIdx = 1;

        // Bescherm het eerste en laatste punt van de fotoperiode zoveel mogelijk
        for (let i = 1; i < list.length - 1; i++) {
            const prev = list[i - 1];
            const curr = list[i];
            const next = list[i + 1];
            const dtTotal = next.mins - prev.mins;
            const frac = dtTotal > 0 ? (curr.mins - prev.mins) / dtTotal : 0.5;

            // Bereken de maximale afwijking t.o.v. een rechte lijn tussen prev en next
            let dev = 0;
            for (let c = 0; c < 6; c++) {
                const expected = prev.values[c] + (next.values[c] - prev.values[c]) * frac;
                dev += Math.abs(curr.values[c] - expected);
            }
            // Geef lichte voorkeur aan het verwijderen van punten die heel dicht op elkaar zitten in tijd
            const timeWeight = Math.min(curr.mins - prev.mins, next.mins - curr.mins) / 60;
            const score = dev * (0.5 + timeWeight);

            if ( sameValues(prev.values, curr.values) && sameValues(curr.values, next.values) ) {
                removeIdx = i;
                break;
            }
            if (score < minScore) {
                minScore = score;
                removeIdx = i;
            }
        }
        list.splice(removeIdx, 1);
    }

    return list.map(({ time, values }) => ({ time, values }));
}

function validateAndNormalizeProfile(rawInput, fallbackLabels = ['UV', 'Deep Blue', 'Blue', 'White', 'Hyper Red', 'IR']) {
    let obj = extractJsonFromText(rawInput, fallbackLabels);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new Error('Profile root must be an object or PROFILE| command.');
    }

    // Pak geneste AI-wrappers automatisch uit, zoals:
    // {"cmd": "load_recipe", "data": {"name": "Nicotiana_13_11", "setpoints": [...]}}
    // of {"profile": {"setpoints": [...]}} of {"recipe": {"schedule": [...]}}
    const wrapperMetadata = {};
    if (typeof obj.name === 'string') wrapperMetadata.crop = obj.name;
    if (typeof obj.crop === 'string') wrapperMetadata.crop = obj.crop;
    if (typeof obj.notes === 'string') wrapperMetadata.notes = obj.notes;

    const nestedCandidates = [obj.data, obj.profile, obj.recipe, obj.payload, obj.config, obj.parameters];
    for (const candidate of nestedCandidates) {
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            if (Array.isArray(candidate.setpoints) || Array.isArray(candidate.schedule) || Array.isArray(candidate.points)) {
                if (typeof candidate.name === 'string' && !wrapperMetadata.crop) wrapperMetadata.crop = candidate.name;
                if (typeof candidate.crop === 'string') wrapperMetadata.crop = candidate.crop;
                if (typeof candidate.notes === 'string') wrapperMetadata.notes = candidate.notes;
                if (typeof candidate.description === 'string' && !wrapperMetadata.notes) wrapperMetadata.notes = candidate.description;
                obj = {
                    ...candidate,
                    labels: candidate.labels || obj.labels,
                    metadata: { ...wrapperMetadata, ...(obj.metadata || {}), ...(candidate.metadata || {}) }
                };
                break;
            }
        }
    }

    const rawSetpointsArray = obj.setpoints || obj.schedule || obj.points || obj.steps;
    if (!Array.isArray(rawSetpointsArray) || rawSetpointsArray.length === 0) {
        throw new Error('Profile is missing a valid "setpoints" array.');
    }

    const warnings = [];
    const infoMessages = [];

    // Labels valideren en aanvullen tot 6 kanalen
    const labels = [];
    const rawLabelsArray = obj.labels || obj.channels || obj.channel_names;
    if (Array.isArray(rawLabelsArray)) {
        if (rawLabelsArray.length !== 6) {
            warnings.push(`Profile specifies ${rawLabelsArray.length} channel labels; BioLights hardware uses 6 channels (GPIO1-GPIO6). Adjusted to 6 channels.`);
        }
        for (let c = 0; c < 6; c++) {
            const rawLbl = rawLabelsArray[c];
            labels.push((typeof rawLbl === 'string' && rawLbl.trim() !== '') ? rawLbl.trim() : (fallbackLabels[c] || `Ch${c + 1}`));
        }
    } else {
        for (let c = 0; c < 6; c++) {
            labels.push(fallbackLabels[c] || `Ch${c + 1}`);
        }
    }

    // Setpoints valideren
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    const parsedSetpoints = rawSetpointsArray.map((sp, idx) => {
        if (!sp || typeof sp !== 'object') {
            throw new Error(`Setpoint #${idx + 1} is not an object.`);
        }
        const timeStr = typeof sp.time === 'string' ? sp.time.trim() : (typeof sp.t === 'string' ? sp.t.trim() : '');
        if (!timeRegex.test(timeStr)) {
            throw new Error(`Setpoint #${idx + 1} has invalid time "${sp.time}" (expected 24h HH:MM format, e.g. "06:00").`);
        }
        const m = timeStr.match(timeRegex);
        const formattedTime = `${m[1].padStart(2, '0')}:${m[2]}`;

        const extractedValues = extractSetpointValues(sp, labels);
        if (!Array.isArray(extractedValues) || extractedValues.length === 0) {
            throw new Error(`Setpoint #${idx + 1} (${formattedTime}) is missing channel values (expected "values": [v1..v6] or "gpio1".."gpio6").`);
        }

        const values = [];
        for (let c = 0; c < 6; c++) {
            const rawVal = extractedValues[c];
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
    let setpoints;
    if (parsedSetpoints.length < 6) {
        warnings.push(`Profile contains ${parsedSetpoints.length} setpoints; padded to 6 rows for the BioLights matrix.`);
        setpoints = [...parsedSetpoints];
        while (setpoints.length < 6) {
            setpoints.push({ time: '00:00', values: [0, 0, 0, 0, 0, 0] });
        }
    } else if (parsedSetpoints.length > 6) {
        setpoints = reduceToSixSetpoints(parsedSetpoints);
        warnings.push(`Profile had ${parsedSetpoints.length} setpoints; intelligently simplified to the 6 key inflection points (${setpoints.map(s => s.time).join(', ')}) for the 6-row BioLights controller.`);
    } else {
        setpoints = parsedSetpoints;
    }

    // Metadata uitlezen (indien meegegeven door een LLM of uit wrapper)
    const combinedMeta = { ...wrapperMetadata, ...(obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {}) };
    if (Object.keys(combinedMeta).length > 0) {
        const metaParts = [];
        if (combinedMeta.crop) metaParts.push(`Crop/Name: ${combinedMeta.crop}`);
        if (combinedMeta.growth_phase) metaParts.push(`Stage: ${combinedMeta.growth_phase}`);
        if (combinedMeta.target_dli !== undefined) metaParts.push(`Target DLI: ${combinedMeta.target_dli} mol/m²/d`);
        if (combinedMeta.photoperiod_hours !== undefined) metaParts.push(`Photoperiod: ${combinedMeta.photoperiod_hours}h`);
        if (metaParts.length > 0) {
            infoMessages.push(`Profile metadata — ${metaParts.join(' | ')}`);
        }
        if (combinedMeta.notes) {
            infoMessages.push(`Profile notes: ${combinedMeta.notes}`);
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
        metadata: Object.keys(combinedMeta).length > 0 ? combinedMeta : null,
        infoMessages,
        warnings
    };
}

// Filtert llms.txt (de single source of truth voor zowel LLM's als gebruikers) op een optioneel
// onderwerp voor weergave in de Communication Terminal via het HELP commando.
function formatHelpFromDocs(markdownText, topic = '') {
    if (!markdownText || typeof markdownText !== 'string') {
        return 'Reference guide is empty.';
    }

    const cleanTopic = (topic || '').trim().toUpperCase();
    const sections = markdownText.split(/\n(?=##\s+)/);

    const topicKeywords = {
        COMMANDS: ['2.', 'COMMANDS', 'RAW COMMAND'],
        CMD: ['2.', 'COMMANDS', 'RAW COMMAND'],
        BUTTONS: ['3.', 'BUTTONS', 'INTERFACE', 'CONTROLS'],
        UI: ['3.', 'BUTTONS', 'INTERFACE', 'CONTROLS'],
        UF2: ['4.', 'FIRMWARE', 'UF2', 'HARDWARE BEHAVIOUR'],
        FIRMWARE: ['4.', 'FIRMWARE', 'UF2', 'HARDWARE BEHAVIOUR'],
        AI: ['1.', '2.', '5.', '6.', 'CAPABILITIES', 'PHOTOBIOLOGICAL'],
        LLM: ['1.', '2.', '5.', '6.', 'CAPABILITIES', 'PHOTOBIOLOGICAL']
    };

    let selectedSections = sections;
    if (cleanTopic && cleanTopic !== 'ALL') {
        const keywords = topicKeywords[cleanTopic] || [cleanTopic];
        const matched = sections.filter((sec, idx) => {
            if (idx === 0) return false;
            const firstLine = (sec.split('\n')[0] || '').toUpperCase();
            return keywords.some(k => firstLine.includes(k));
        });
        if (matched.length > 0) {
            selectedSections = [sections[0], ...matched];
        }
    }

    return selectedSections
        .join('\n\n')
        .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isPipeProfileCommand,
        parsePipeProfileCommand,
        formatProfileCommand,
        extractJsonFromText,
        decodeProfileParam,
        extractSetpointValues,
        reduceToSixSetpoints,
        validateAndNormalizeProfile,
        formatHelpFromDocs
    };
}
