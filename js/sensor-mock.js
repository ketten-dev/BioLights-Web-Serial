// Verwacht interpolateFrame/interpolateValue/formatSensorInfoLine/formatSensorSettingsLine/
// formatSensorDataLine/parseSensorSetLine/SENSOR_READ_LINE als globals (geladen via eerdere
// <script>-tags in de browser; in Node zet de testsetup ze zelf op `global`).

function getMockBandValues(scenario, nowMinutes) {
    const sorted = scenario.timeline
        .map((point, idx) => ({ time: point.time_mins, values: point.values, originalIndex: idx }))
        .sort((a, b) => a.time - b.time);
    const frame = interpolateFrame(sorted, nowMinutes);
    return scenario.bands.map((band, i) => {
        const raw = interpolateValue(frame, nowMinutes, i);
        return Math.max(0, Math.min(1, raw));
    });
}

function mockHandleCommand(scenario, line, nowMinutes) {
    if (line === SENSOR_READ_LINE) {
        const values = getMockBandValues(scenario, nowMinutes);
        return [
            formatSensorInfoLine(scenario.sensor_name, scenario.bands),
            formatSensorSettingsLine(scenario.settings),
            formatSensorDataLine(values)
        ];
    }

    const setCmd = parseSensorSetLine(line);
    if (setCmd) {
        const setting = scenario.settings.find(s => s.key === setCmd.key);
        if (setting) {
            if (setting.type === 'number') {
                setting.value = Math.max(setting.min, Math.min(setting.max, setCmd.value));
            } else if (setting.type === 'enum' && setting.options.includes(setCmd.value)) {
                setting.value = setCmd.value;
            }
        }
        return [formatSensorSettingsLine(scenario.settings)];
    }

    return [];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getMockBandValues, mockHandleCommand };
}
