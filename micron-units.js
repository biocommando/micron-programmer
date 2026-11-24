// Conversions between raw Micron parameter values and real-world units.
// Each unit applies to parameters whose name matches `match`, and provides:
//   parse(text)  -> value in the unit (ms, Hz, ...) or undefined if text isn't in this unit
//   toRaw(value) -> raw parameter value
//   fromRaw(raw) -> value in the unit
//   format(value)-> display string

// Exponential raw <-> milliseconds mapping: ms = minMs * ratio^(raw/maxRaw)
function expTimeUnit(match, minMs, ratio, maxRaw) {
    return {
        match,
        MIN: minMs,
        MAX: minMs * ratio,
        fromRaw: raw => minMs * Math.pow(ratio, raw / maxRaw),
        toRaw: ms => {
            if (!(ms > minMs)) return 0
            return Math.min(maxRaw, Math.round(maxRaw * Math.log(ms / minMs) / Math.log(ratio)))
        },
        format: ms => {
            if (ms < 10) return ms.toFixed(2) + ' ms'
            if (ms < 1000) return ms.toFixed(1) + ' ms'
            return (ms / 1000).toFixed(2) + ' s'
        },
        // "250ms", "2.5s", "2.5 s" -> ms
        parse: text => {
            const m = String(text).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)$/i)
            if (!m) return undefined
            return Number(m[1]) * (m[2].toLowerCase() === 's' ? 1000 : 1)
        },
        // Script notation, e.g. "250ms" / "2.5s"
        notation: ms => ms >= 1000 ? +(ms / 1000).toFixed(2) + 's' : +ms.toFixed(1) + 'ms',
    }
}

// Envelope times (raw 0..255), fitted to values measured on hardware:
//   time = 0.5 ms * 60000^(raw/255)   ->  0 = 0.5 ms, 100 = 37.4 ms, 200 = 2.8 s, 255 = 30 s
// Sustain time is assumed to use the same curve (attack/decay/release were measured).
const envTime = expTimeUnit(/^envelope \d (attack|decay|sustain|release) time$/i, 0.5, 60000, 255)

// Portamento time (raw 0..127): time = 10 ms * 1000^(raw/127)  ->  10 ms .. 10 s
const portaTime = expTimeUnit(/^portamento time$/i, 10, 1000, 127)

// Filter frequency (raw 0..1023) is exponential, fitted to values measured on hardware:
//   f = 20 Hz * 1000^(raw/1023)   ->  0 = 20 Hz, 439 = 388 Hz, 859 = 6.6 kHz
// The curve would reach 20 kHz at 1023, but the Micron tops out at 10 kHz (from raw ~921 up).
const filterFreq = {
    match: /^filter [12] frequency( absolute)?$/i,
    MAX: 10000,
    fromRaw: raw => Math.min(10000, 20 * Math.pow(1000, raw / 1023)),
    toRaw: hz => {
        if (!(hz > 20)) return 0
        if (hz >= 10000) return 1023 // fully open; everything from ~921 up is 10 kHz
        return Math.min(1023, Math.round(1023 * Math.log(hz / 20) / Math.log(1000)))
    },
    format: hz => hz < 1000 ? hz.toFixed(1) + ' Hz' : (hz / 1000).toFixed(2) + ' kHz',
    parse: text => parseHz(text),
    notation: hz => hz >= 1000 ? +(hz / 1000).toFixed(3) + 'kHz' : +hz.toFixed(1) + 'Hz',
}

// "440Hz", "1.5kHz", "1.5 khz" -> Hz (shared by all Hz-based units)
const parseHz = text => {
    const m = String(text).trim().match(/^(\d+(?:\.\d+)?)\s*(hz|khz)$/i)
    if (!m) return undefined
    return Number(m[1]) * (m[2].toLowerCase() === 'khz' ? 1000 : 1)
}

// Exponential raw <-> Hz mapping: hz = minHz * ratio^(raw/maxRaw)
function expHzUnit(match, minHz, ratio, maxRaw) {
    const maxHz = minHz * ratio
    return {
        match,
        MIN: minHz,
        MAX: maxHz,
        fromRaw: raw => minHz * Math.pow(ratio, raw / maxRaw),
        toRaw: hz => {
            if (!(hz > minHz)) return 0
            return Math.min(maxRaw, Math.round(maxRaw * Math.log(hz / minHz) / Math.log(ratio)))
        },
        format: hz => hz < 1 ? hz.toFixed(3) + ' Hz' : hz < 10 ? hz.toFixed(2) + ' Hz' : hz.toFixed(1) + ' Hz',
        parse: parseHz,
        notation: hz => +hz.toPrecision(4) + 'Hz',
    }
}

// LFO 1/2 and S&H free rates (raw 0..1023): hz = 0.01 Hz * 1000^(raw/1023)  ->  0.01 Hz .. 10 Hz
const lfoRate = expHzUnit(/^(lfo [12] rate \(free\)|S&H rate\(free\))$/i, 0.01, 1000, 1023)
const shRate = lfoRate

const micronUnits = {
    envTime,
    portaTime,
    filterFreq,
    lfoRate,
    shRate,
    all: [envTime, portaTime, filterFreq, lfoRate],

    // The unit used by a parameter (by its full name), or undefined
    forParam(name) {
        return this.all.find(u => u.match.test(name))
    },

    // True if the text is a value in any known unit (used for error messages)
    isUnitValue(text) {
        return this.all.some(u => u.parse(text) !== undefined)
    },
}
