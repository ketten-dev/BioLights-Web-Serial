function formatSensorInfoLine(sensorName, bands, present = true) {
    const bandParts = bands.map(b => {
        const wl = (b.wavelength_nm === null || b.wavelength_nm === undefined) ? '' : b.wavelength_nm;
        const fw = (b.fwhm_nm === null || b.fwhm_nm === undefined) ? '' : b.fwhm_nm;
        return `${b.label},${wl},${fw}`;
    });
    return `SENSOR_INFO|${sensorName}|${bands.length}|${present ? 1 : 0}|${bandParts.join('|')}`;
}

function parseSensorInfoLine(line) {
    if (!line.startsWith('SENSOR_INFO|')) return null;
    const parts = line.split('|');
    const sensorName = parts[1];
    const present = parts[3] === '1';
    const bandSegments = parts.slice(4);
    const bands = bandSegments.map(seg => {
        const [label, wlStr, fwStr] = seg.split(',');
        return {
            label,
            wavelength_nm: (wlStr === '' || wlStr === undefined) ? null : parseFloat(wlStr),
            fwhm_nm: (fwStr === '' || fwStr === undefined) ? null : parseFloat(fwStr)
        };
    });
    return { sensorName, present, bands };
}

function formatSensorSettingsLine(settings) {
    const segs = settings.map(s => {
        if (s.type === 'number') {
            return `${s.key},number,${s.min},${s.max},${s.step},${s.value}`;
        }
        return `${s.key},enum,${s.options.join(',')},${s.value}`;
    });
    return `SENSOR_SETTINGS|${segs.join('|')}`;
}

function parseSensorSettingsLine(line) {
    if (!line.startsWith('SENSOR_SETTINGS|')) return null;
    const parts = line.split('|');
    const segs = parts.slice(1);
    return segs.map(seg => {
        const fields = seg.split(',');
        const key = fields[0];
        const type = fields[1];
        if (type === 'number') {
            return {
                key, type,
                min: parseFloat(fields[2]),
                max: parseFloat(fields[3]),
                step: parseFloat(fields[4]),
                value: parseFloat(fields[5])
            };
        }
        const options = fields.slice(2, fields.length - 1).map(parseFloat);
        const value = parseFloat(fields[fields.length - 1]);
        return { key, type, options, value };
    });
}

function formatSensorDataLine(values) {
    return `SENSOR_DATA|${values.map(v => v.toFixed(4)).join(',')}`;
}

function parseSensorDataLine(line) {
    if (!line.startsWith('SENSOR_DATA|')) return null;
    return line.slice('SENSOR_DATA|'.length).split(',').map(parseFloat);
}

const SENSOR_READ_LINE = 'SENSOR_READ';

function formatSensorSetLine(key, value) {
    return `SENSOR_SET|${key}=${value}`;
}

function parseSensorSetLine(line) {
    if (!line.startsWith('SENSOR_SET|')) return null;
    const payload = line.slice('SENSOR_SET|'.length);
    const eqIdx = payload.indexOf('=');
    if (eqIdx === -1) return null;
    return { key: payload.slice(0, eqIdx), value: parseFloat(payload.slice(eqIdx + 1)) };
}

// Read-only diagnostische velden (bv. ruwe registerwaarden) — puur inzicht,
// geen gemeten band en geen instelbare setting. `value` blijft hier bewust
// een string (niet parseFloat'd): het kan een hex-notatie ("0x39") of "err"
// zijn, niet per se een getal.
function formatSensorDebugInfoLine(fields) {
    const segs = fields.map(f => `${f.key}=${f.value}`);
    return `SENSOR_DEBUG_INFO|${segs.join('|')}`;
}

function parseSensorDebugInfoLine(line) {
    if (!line.startsWith('SENSOR_DEBUG_INFO|')) return null;
    const parts = line.split('|');
    const segs = parts.slice(1);
    return segs.map(seg => {
        const eqIdx = seg.indexOf('=');
        return { key: seg.slice(0, eqIdx), value: seg.slice(eqIdx + 1) };
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatSensorInfoLine, parseSensorInfoLine,
        formatSensorSettingsLine, parseSensorSettingsLine,
        formatSensorDataLine, parseSensorDataLine,
        formatSensorSetLine, parseSensorSetLine,
        formatSensorDebugInfoLine, parseSensorDebugInfoLine,
        SENSOR_READ_LINE
    };
}
