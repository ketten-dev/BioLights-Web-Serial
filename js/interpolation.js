// Rekenmachine: zet een tijdstekst (zoals "14:30") om in pure minuten (zoals 870)
function getMins(timeStr) {
    if (!timeStr) return 0;
    let [h, m] = timeStr.split(':');
    return parseInt(h, 10) * 60 + parseInt(m, 10);
}

// Zoekt de setpoints vóór en ná tijdstip 'nu' en corrigeert voor het middernacht-wraparound.
function interpolateFrame(sorted, nu) {
    let sp_prev = sorted[sorted.length - 1];
    let sp_next = sorted[0];

    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].time <= nu) {
            sp_prev = sorted[i];
            sp_next = sorted[(i + 1) % sorted.length];
        }
    }

    let T1 = sp_prev.time;
    let T2 = sp_next.time;
    if (T1 > nu && T1 >= T2) T1 -= 1440;
    if (T2 < nu || T2 <= T1) T2 += 1440;

    return { sp_prev, sp_next, T1, T2 };
}

// Berekent de geïnterpoleerde waarde van 1 kanaal binnen een eerder bepaald frame
function interpolateValue(frame, nu, channel) {
    const { sp_prev, sp_next, T1, T2 } = frame;
    let val = sp_prev.values[channel];
    if (T1 !== T2) {
        val = sp_prev.values[channel] + (sp_next.values[channel] - sp_prev.values[channel]) * (nu - T1) / (T2 - T1);
    }
    return val;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getMins, interpolateFrame, interpolateValue };
}
