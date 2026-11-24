// Parameterizable automation presets. Each preset renders a small form and
// generates an automation script into the automation editor textarea.
//
// Generated scripts use the native-value syntax `name := value` (raw Micron
// units, e.g. filter frequency 0..1023) so they stay readable and editable.
// Option names (e.g. `drty = compressor`) are used where the parameter has them.

const automationPresets = (() => {
    // ---- helpers ------------------------------------------------------------
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
    const pct = p => Math.round(p * 10) // patch cable level/offset: -1000..1000 = -100.0..100.0 %

    // Small seeded PRNG so randomized scripts are reproducible from a seed
    function mulberry32(seed) {
        return () => {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0
            let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
            return ((t ^ t >>> 14) >>> 0) / 4294967296
        }
    }

    function writer() {
        const lines = []
        return {
            lines,
            comment: text => lines.push('# ' + text),
            blank: () => lines.push(''),
            // string -> option name, number -> native value
            set: (shortName, value) => lines.push(typeof value === 'string'
                ? `${shortName} = ${value}`
                : `${shortName} := ${Math.round(value)}`),
            // Envelope time in milliseconds, written with a unit so the script stays readable
            time: (shortName, ms) =>
                lines.push(`${shortName} := ${micronUnits.envTime.notation(clamp(ms, 0, micronUnits.envTime.MAX))}`),
            // Filter frequency in Hz
            freq: (shortName, hz) =>
                lines.push(`${shortName} := ${micronUnits.filterFreq.notation(clamp(hz, 20, micronUnits.filterFreq.MAX))}`),
            // Any other unit from micronUnits that has MIN/MAX, e.g. w.unit('shrafr', micronUnits.shRate, 4)
            unit: (shortName, unit, value) =>
                lines.push(`${shortName} := ${unit.notation(clamp(value, unit.MIN, unit.MAX))}`),
            cable: (n, source, destination, levelPct, offsetPct = 0) => {
                lines.push(`paca${n}so = ${source}`)
                lines.push(`paca${n}de = ${destination}`)
                lines.push(`paca${n}le := ${pct(levelPct)}`)
                lines.push(`paca${n}of := ${pct(offsetPct)}`)
            }
        }
    }

    // Semitone offset -> octave + transpose (transpose is limited to -7..7)
    function semitonesToOctTr(semis) {
        const oct = Math.round(semis / 12)
        return { oct, tr: semis - 12 * oct }
    }

    // Waveform picker shared by oscillator presets
    const waveChoices = ['saw', 'triangle', 'square', 'sine']
    function setWave(w, osc, wave) {
        const map = {
            saw: ['tri/saw', 100],
            triangle: ['tri/saw', 0],
            square: ['pulse', 0],
            sine: ['sine', 0]
        }
        const [waveform, shape] = map[wave]
        w.set(`os${osc}wa`, waveform)
        w.set(`os${osc}wash`, shape)
    }

    const lfoWaves = ['sin', 'tri', 'sqr', 'saw', 'c sin', 'c tri', 'c sqr', 'c saw']
    function setLfoRate(w, lfo, p) {
        if (p.sync === 'tempo sync') {
            w.set(`lf${lfo}tesy`, 'tempo sync')
            w.set(`lf${lfo}rafote`, p.syncRate)
        } else {
            w.set(`lf${lfo}tesy`, 'fixed rate')
            w.unit(`lf${lfo}rafr`, micronUnits.lfoRate, p.rate)
        }
    }
    const lfoRateParams = [
        { id: 'sync', label: 'Rate mode', type: 'select', options: ['fixed rate', 'tempo sync'], default: 'fixed rate' },
        { id: 'rate', label: 'Free rate (Hz, 0.01-10)', type: 'number', min: 0.01, max: 10, step: 0.01, default: 2 },
        { id: 'syncRate', label: 'Synced rate (x tempo)', type: 'select', options: 'syncrate', default: 'x1' },
    ]
    const cableParam = (def = 1) => ({ id: 'cable', label: 'Patch cable #', type: 'number', min: 1, max: 12, default: def })

    // ---- random patch generator data ------------------------------------------
    // Each sound type is a set of ranges ([min, max]) and weighted choices
    // ({ option: weight }) the generator draws from. Times are ms, cutoff Hz.
    //   mod      : modulation depth multiplier (LFO effects)
    //   lfoRate  : multiplier for the slow LFO effects (wobble / shape / pan)
    //   octave   : base octave choices for osc 1 (all octaves stay within -2..0)
    //   osc      : oscillator recipe weights (see buildOscillators)
    //   m1 / m2  : what the M1 / M2 sliders get mapped to (see sliderTargets)
    //   ampSlope : fixed amp decay/release slope (default random). Program level is set by estimateLoudness
    //   shapes   : wave shape range per waveform (default: tri/saw 20..100, pulse -60..60, sine 0..30;
    //              tri/saw 100 = saw, 0 = triangle)
    //   unisonDetune : unison detune range when unison is on (default 10..30)
    //   vel/fvel : amp / filter envelope velocity sensitivity (fvel defaults to vel)
    const lowpass = { 'lowpass ob_2pole': 2, 'lowpass tb_3pole': 1, 'lowpass mg_4pole': 2, 'lowpass rp_4pole': 1, 'lowpass jp_4pole': 2 }
    const soundProfiles = {
        bass: {
            category: 'bass', mod: 0.5, lfoRate: 1.5,
            mono: 0.6, porta: 0.3, unison: 0, drift: [0, 10],
            octave: [-1], osc: { single: 2, 'octave stack': 3, 'detuned pair': 2, fm: 2, sync: 1 },
            waves: { sine: 1, 'tri/saw': 4, pulse: 3 }, detune: [3, 10], fm: [100, 400],
            amp: { a: [0.5, 5], d: [150, 800], s: [40, 100], r: [20, 150] },
            fenv: { a: [0.5, 5], d: [80, 600], s: [0, 30], r: [20, 150] }, fenvAmount: [30, 70],
            filter: { 'lowpass mg_4pole': 3, 'lowpass rp_4pole': 2, 'lowpass tb_3pole': 2, 'lowpass jp_4pole': 1, 'lowpass ob_2pole': 1 },
            cutoff: [150, 1200], res: [0, 60], keytrack: [20, 60], vel: [20, 50],
            lfoCount: [0, 1], lfo: { wobble: 2, shape: 2 },
            drive: { bypass: 3, compressor: 2, 'tube overdrive': 2, distortion: 1, 'tube amp': 1 }, driveLevel: [10, 40],
            fx1: { bypass: 4, chorus: 2, 'phaser super': 1 },
            fx2: { bypass: 4, 'reverb room': 1, 'delay mono': 1 }, mix: [-40, -20],
            m1: { cutoff: 4, 'filter env': 3, resonance: 2 },
            m2: { drive: 2, 'osc shape': 2, 'fm amount': 2, decay: 2, resonance: 1 },
        },
        lead: {
            category: 'lead', mod: 0.8, lfoRate: 1,
            mono: 0.6, porta: 0.5, unison: 0.25, drift: [5, 15],
            octave: [0, -1], osc: { single: 1, 'octave stack': 2, 'detuned pair': 3, fm: 1, sync: 2 },
            waves: { sine: 0.5, 'tri/saw': 4, pulse: 3 }, detune: [5, 15], fm: [100, 300],
            amp: { a: [0.5, 30], d: [200, 1500], s: [60, 100], r: [80, 400] },
            fenv: { a: [0.5, 30], d: [200, 1500], s: [20, 60], r: [80, 400] }, fenvAmount: [15, 50],
            filter: { ...lowpass, 'lowpass al_8pole': 1 },
            cutoff: [500, 4000], res: [0, 50], keytrack: [30, 80], vel: [10, 40],
            lfoCount: [1, 1], lfo: { vibrato: 4, shape: 2, wobble: 1 },
            drive: { bypass: 2, 'tube overdrive': 3, distortion: 2, 'tube amp': 2, 'fuzz pedal': 1 }, driveLevel: [15, 50],
            fx1: { bypass: 2, chorus: 2, 'flanger theta': 1, 'phaser super': 1 },
            fx2: { 'delay stereo': 3, 'delay split L/R': 2, 'reverb plate': 2, 'reverb hall': 1 }, mix: [-30, 0],
            m1: { cutoff: 3, 'lfo depth': 4, 'filter env': 1 },
            m2: { resonance: 2, 'osc shape': 2, 'fm amount': 1, drive: 2, 'fx mix': 1, 'lfo rate': 1 },
        },
        pad: {
            // soft, slow, subtle: no unison, chorus + reverb, gentle lowpass, slow LFOs
            category: 'pad', mod: 1, lfoRate: 0.3,
            mono: 0, porta: 0, unison: 0.1, unisonDetune: [5, 12], drift: [5, 18],
            octave: [0, -1], osc: { 'detuned trio': 4, 'octave stack': 2, 'detuned pair': 2 },
            waves: { sine: 1, 'tri/saw': 4, pulse: 2 }, detune: [8, 18],
            amp: { a: [300, 3000], d: [1000, 5000], s: [60, 100], r: [1500, 6000] },
            fenv: { a: [500, 5000], d: [1500, 6000], s: [20, 70], r: [1500, 6000] }, fenvAmount: [-30, 50],
            filter: { 'lowpass ob_2pole': 2, 'lowpass mg_4pole': 2, 'lowpass jp_4pole': 2 },
            cutoff: [400, 4000], res: [0, 20], keytrack: [0, 50], vel: [0, 20], noise: 0.3,
            lfoCount: [1, 2], lfo: { wobble: 3, shape: 3, 'auto-pan': 2, vibrato: 1 },
            drive: { bypass: 5, compressor: 1 }, driveLevel: [5, 20],
            fx1: { chorus: 6, 'phaser string': 1 },
            fx2: { 'reverb hall': 4, 'reverb plate': 2, 'delay stereo': 0.5 }, mix: [-10, 20],
            m1: { cutoff: 3, 'lfo depth': 3, 'filter env': 1 },
            m2: { 'lfo rate': 2, resonance: 1, 'fx mix': 2, attack: 1, release: 1, noise: 1, 'osc shape': 2 },
        },
        atmo: {
            // the wilder pad: unison, drift, flangers/phasers, formant filters, faster movement
            category: 'sfx', mod: 1.3, lfoRate: 0.5,
            mono: 0, porta: 0, unison: 0.4, drift: [10, 30],
            octave: [0, -1], osc: { 'detuned trio': 4, 'octave stack': 2, 'detuned pair': 2 },
            waves: { sine: 1, 'tri/saw': 4, pulse: 2 }, detune: [8, 25],
            amp: { a: [300, 3000], d: [1000, 5000], s: [60, 100], r: [1500, 6000] },
            fenv: { a: [500, 5000], d: [1500, 6000], s: [20, 70], r: [1500, 6000] }, fenvAmount: [-30, 50],
            filter: { 'lowpass ob_2pole': 2, 'lowpass mg_4pole': 2, 'lowpass jp_4pole': 2, 'bandpass ob_2pol': 1, 'vocal formant 1': 0.5 },
            cutoff: [400, 5000], res: [0, 40], keytrack: [0, 50], vel: [0, 20], noise: 0.3,
            lfoCount: [1, 2], lfo: { wobble: 3, shape: 2, 'auto-pan': 3, vibrato: 1 },
            drive: { bypass: 5, compressor: 1 }, driveLevel: [5, 20],
            fx1: { chorus: 3, 'phaser string': 2, 'flanger thru-0': 1, 'phaser super': 1 },
            fx2: { 'reverb hall': 4, 'reverb plate': 2, 'delay stereo': 1 }, mix: [-10, 20],
            m1: { cutoff: 3, 'lfo depth': 3, 'filter env': 1 },
            m2: { 'lfo rate': 2, resonance: 2, 'fx mix': 2, attack: 1, release: 1, noise: 1, 'unison detune': 1, 'osc shape': 2 },
        },
        keys: {
            category: 'key', mod: 0.8, lfoRate: 1,
            mono: 0, porta: 0, unison: 0, drift: [0, 10],
            octave: [0], osc: { single: 2, 'octave stack': 2, 'detuned pair': 1, fm: 3 },
            waves: { sine: 2, 'tri/saw': 2, pulse: 2 }, detune: [2, 8], fm: [100, 300],
            amp: { a: [0.5, 5], d: [800, 4000], s: [0, 50], r: [200, 800] },
            fenv: { a: [0.5, 5], d: [300, 2000], s: [0, 40], r: [200, 800] }, fenvAmount: [20, 50],
            filter: { 'lowpass ob_2pole': 3, 'lowpass jp_4pole': 2, 'lowpass mg_4pole': 1 },
            cutoff: [600, 4000], res: [0, 25], keytrack: [40, 100], vel: [30, 70],
            lfoCount: [0, 1], lfo: { tremolo: 2, 'auto-pan': 3, vibrato: 1 },
            drive: { bypass: 3, compressor: 2, 'tube amp': 2 }, driveLevel: [5, 25],
            fx1: { bypass: 2, chorus: 2, 'phaser super': 2 },
            fx2: { 'reverb room': 2, 'reverb plate': 2, 'delay stereo': 1 }, mix: [-35, -10],
            m1: { cutoff: 3, 'lfo depth': 3 },
            m2: { 'fm amount': 2, drive: 2, decay: 2, 'fx mix': 1, 'lfo rate': 2 },
        },
        pluck: {
            category: 'key', mod: 0.6, lfoRate: 1, ampSlope: 'linear',
            mono: 0, porta: 0, unison: 0, drift: [0, 10],
            octave: [0], osc: { single: 2, 'octave stack': 2, 'detuned pair': 2, fm: 2 },
            waves: { sine: 0.5, 'tri/saw': 3, pulse: 2 }, detune: [3, 12], fm: [150, 400],
            amp: { a: [0.5, 3], d: [300, 1200], s: [0, 25], r: [200, 700] },
            fenv: { a: [0.5, 3], d: [150, 700], s: [0, 10], r: [150, 500] }, fenvAmount: [50, 85],
            filter: { 'lowpass ob_2pole': 2, 'lowpass tb_3pole': 2, 'lowpass mg_4pole': 2 },
            cutoff: [600, 2500], res: [5, 40], keytrack: [40, 100], vel: [10, 35],
            lfoCount: [0, 1], lfo: { 'auto-pan': 2, wobble: 1 },
            drive: { bypass: 2, compressor: 3, 'tube overdrive': 1 }, driveLevel: [15, 35],
            fx1: { bypass: 2, chorus: 2 },
            fx2: { 'delay stereo': 3, 'delay split L/R': 2, 'reverb plate': 2 }, mix: [-25, 0],
            m1: { cutoff: 3, 'filter env': 3, resonance: 1 },
            m2: { decay: 3, 'fx mix': 2, 'osc shape': 2, 'fm amount': 1 },
        },
        strings: {
            category: 'string', mod: 0.7, lfoRate: 0.6,
            mono: 0, porta: 0, unison: 0.6, unisonDetune: [5, 12], drift: [5, 12],
            octave: [0], osc: { 'detuned trio': 5, 'detuned pair': 1 },
            waves: { 'tri/saw': 3, pulse: 2 }, shapes: { 'tri/saw': [85, 100], pulse: [20, 60] }, detune: [3, 8],
            amp: { a: [100, 800], d: [500, 2000], s: [85, 100], r: [400, 1500] },
            fenv: { a: [100, 1000], d: [800, 2000], s: [40, 80], r: [400, 1500] }, fenvAmount: [10, 30],
            filter: { 'lowpass ob_2pole': 3, 'lowpass jp_4pole': 3 },
            cutoff: [1500, 6000], res: [0, 20], keytrack: [30, 80], vel: [5, 20], noise: 0.2,
            lfoCount: [1, 2], lfo: { vibrato: 3, 'auto-pan': 2, shape: 1 },
            drive: { bypass: 1 }, driveLevel: [0, 0],
            fx1: { chorus: 3, 'phaser string': 3 },
            fx2: { 'reverb hall': 3, 'reverb plate': 2 }, mix: [-20, 10],
            m1: { 'lfo depth': 3, cutoff: 3 },
            m2: { attack: 2, release: 1, 'fx mix': 1, 'osc shape': 1, 'unison detune': 1, 'lfo rate': 1 },
        },
        brass: {
            // saws through a low filter opened by a strong filter envelope; velocity -> brightness
            category: 'brass', mod: 0.6, lfoRate: 1,
            mono: 0.1, porta: 0.2, unison: 0.4, drift: [5, 15],
            octave: [0, -1], osc: { 'detuned trio': 3, 'detuned pair': 2 },
            waves: { 'tri/saw': 1 }, shapes: { 'tri/saw': [90, 100] }, detune: [3, 7],
            amp: { a: [20, 80], d: [200, 800], s: [80, 100], r: [100, 300] },
            fenv: { a: [40, 150], d: [300, 900], s: [30, 60], r: [100, 300] }, fenvAmount: [50, 80],
            filter: { 'lowpass ob_2pole': 2, 'lowpass mg_4pole': 2, 'lowpass jp_4pole': 2 },
            cutoff: [400, 1200], res: [0, 15], keytrack: [30, 70], vel: [5, 25], fvel: [30, 60],
            lfoCount: [0, 1], lfo: { vibrato: 4 },
            drive: { bypass: 2, 'tube amp': 2, compressor: 1 }, driveLevel: [10, 30],
            fx1: { bypass: 2, chorus: 1 },
            fx2: { 'reverb hall': 2, 'reverb room': 2 }, mix: [-30, -10],
            m1: { cutoff: 3, 'filter env': 3, 'lfo depth': 2 },
            m2: { attack: 2, resonance: 1, drive: 2, 'osc shape': 1 },
        },
    }

    // LFO effects. `slow` effects have their rate multiplied by the profile's lfoRate.
    const lfoEffects = {
        vibrato: { waves: ['sin', 'tri'], rate: [4.5, 6.5], depth: [1, 3], reset: 'poly (per voice)', dests: c => ['pitch'] },
        wobble: { waves: ['tri', 'sin'], rate: [0.2, 2], depth: [8, 25], reset: 'mono (per pgm)', slow: true, dests: c => ['flt1 frq'] },
        // PWM on pulse waves, shape morph on tri/saw
        shape: { waves: ['tri', 'sin'], rate: [0.2, 1.5], depth: [15, 40], reset: 'poly (per voice)', slow: true, dests: c => c.shapedOscs.map(n => `osc${n} shp`) },
        'auto-pan': { waves: ['sin', 'tri'], rate: [0.1, 1], depth: [20, 50], reset: 'mono (per pgm)', slow: true, dests: c => ['pan'] },
        tremolo: { waves: ['sin', 'tri'], rate: [3, 7], depth: [10, 25], reset: 'mono (per pgm)', dests: c => ['program level'] },
    }

    // ---- loudness estimate ----------------------------------------------------
    // Rough perceived loudness (dB, relative) of a generated patch, used to set the
    // program level so patches come out at a consistent volume. It models the
    // harmonic spectrum of each oscillator at middle C, the filter roll-off at the
    // cutoff the ear mostly hears (cutoff + part of the filter envelope), a mild
    // equal-loudness weighting (low notes sound quieter), resonance loss, amp
    // envelope, velocity sensitivity and unison. Absolute values are meaningless;
    // only differences between patches matter.
    const filterPoles = { 'lowpass ob_2pole': 2, 'lowpass tb_3pole': 3, 'lowpass mg_4pole': 4, 'lowpass rp_4pole': 4, 'lowpass jp_4pole': 4, 'lowpass al_8pole': 8 }
    const MIDDLE_C = 261.6
    // A patch with estimated loudness LOUDNESS_REF gets program level LEVEL_REF
    // (anchored near the quiet end, since the level can't go above 100)
    const LOUDNESS_REF = -9, LEVEL_REF = 100
    // Share of the estimated difference that is corrected (1 = trust the estimate fully)
    const LOUDNESS_COMPENSATION = 0.6
    function aWeightDb(f) {
        const f2 = f * f
        const ra = 12194 ** 2 * f2 * f2 / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
        return 20 * Math.log10(ra) + 2
    }
    // Harmonic amplitudes (peak-normalized waves) of one oscillator
    function harmonic(wave, shape, n) {
        if (wave === 'sine') return n === 1 ? 1 : 0
        if (wave === 'pulse') {
            const duty = Math.max(0.02, 0.5 * (1 - Math.abs(shape) / 100))
            return 4 / (Math.PI * n) * Math.abs(Math.sin(Math.PI * n * duty))
        }
        const t = Math.abs(shape) / 100 // tri/saw: 0 = triangle, 100 = saw
        const saw = 2 / (Math.PI * n)
        const tri = n % 2 ? 8 / (Math.PI * Math.PI * n * n) : 0
        return t * saw + (1 - t) * tri
    }
    function filterGain(type, fc, f) {
        if (type in filterPoles) return 1 / Math.sqrt(1 + (f / fc) ** (2 * filterPoles[type]))
        if (type.startsWith('bandpass')) return 1 / Math.sqrt(1 + (f / fc - fc / f) ** 2)
        return 0.7 // formant / other: assume about -3 dB
    }
    function estimateLoudness({ oscs, filterType, cutoff, res, fenvAmount, env1, env2, unison, drive, driveLevel }) {
        // Filter cutoff the ear mostly hears: plucky sounds are judged by their bright
        // start, sustained sounds by the sustain part of the filter envelope.
        // Envelope amount 100 % is assumed to sweep the whole ~9 octave range.
        const sustained = env1.s / 100
        const envPart = (1 - 0.75 * sustained) + 0.75 * sustained * Math.max(0, env2.s / 100)
        const fc = clamp(cutoff * 2 ** (9 * fenvAmount / 100 * envPart), 20, 10000)
        let power = 0
        for (const o of oscs) {
            if (!o.level) continue
            const f0 = MIDDLE_C * 2 ** o.oct
            for (let n = 1; n * f0 < 10000 && n <= 64; n++) {
                const f = n * f0
                const a = harmonic(o.wave, o.shape, n) * filterGain(filterType, fc, f) * o.level / 100
                power += a * a * 10 ** (aWeightDb(f) / 2 / 10) // half of A-weighting: milder than at low volume
            }
        }
        let db = 10 * Math.log10(Math.max(power, 1e-9))
        if (filterPoles[filterType] >= 4) db += 20 * Math.log10(1 - 0.5 * res / 100) // 4-pole passband loss
        // Amp envelope: sustain level, or a decaying note judged mostly by its start
        const ampHold = Math.max(env1.s / 100, 0.35 + 0.35 * Math.min(1, env1.d / 1000))
        db += 20 * Math.log10(ampHold)
        db += 20 * Math.log10(1 - env1.vel / 100 * 0.3) // velocity sensitivity at a medium-hard velocity
        if (unison) db += 3
        if (drive !== 'bypass') db += 3 * driveLevel / 100
        return db
    }

    // M1 / M2 slider targets. Each returns { label, routes: [{ dest, level }] }, or
    // null when it would not be audible in the generated patch. Levels push the
    // parameter away from the end of its range it is already near, so the slider
    // never just clips (e.g. a saw at shape 100 is moved towards triangle).
    // 'lfo depth' is M1 only: it uses the Micron's own "M1 slider influence" on
    // the LFO instead of a patch cable. Slider amounts don't follow Modulation %.
    const toward = (shouldGoDown, amount) => shouldGoDown ? -amount : amount
    const sliderTargets = {
        cutoff: c => ({ label: 'filter 1 cutoff', routes: [{ dest: 'flt1 frq', level: toward(c.cutoff > 2500, c.rr(50, 80)) }] }),
        resonance: c => ({ label: 'filter 1 resonance', routes: [{ dest: 'flt1 res', level: toward(c.res > 50, c.rr(40, 70)) }] }),
        'filter env': c => ({ label: 'filter envelope amount', routes: [{ dest: 'flt1 env', level: toward(c.fenvAmount >= 50 || (c.fenvAmount < 0 && c.fenvAmount > -50), c.rr(40, 70)) }] }),
        'lfo depth': c => c.lfos.length ? { label: `lfo ${c.lfos[0].lfo} (${c.lfos[0].name}) depth`, influence: c.lfos[0].lfo, routes: [] } : null,
        'lfo rate': c => {
            const l = c.lfos.find(x => x.depth > 0)
            return l ? { label: `lfo ${l.lfo} (${l.name}) rate`, routes: [{ dest: `lfo${l.lfo} rate`, level: toward(l.rate > 4, c.rr(30, 60)) }] } : null
        },
        'osc shape': c => c.shapedOscs.length ? {
            label: 'oscillator shape',
            routes: c.shapedOscs.map(n => ({ dest: `osc${n} shp`, level: toward(c.oscs[n - 1].shape >= 0, c.oscs[n - 1].wave === 'pulse' ? c.rr(40, 70) : c.rr(50, 80)) }))
        } : null,
        'fm amount': c => c.oscs[0].level > 0 ? { label: 'FM amount', routes: [{ dest: 'fm amount', level: c.rr(30, 60) }] } : null,
        drive: c => c.drive !== 'bypass' ? { label: 'drive level', routes: [{ dest: 'drive level', level: c.rr(40, 70) }] } : null,
        'fx mix': c => c.fxActive ? { label: 'FX mix', routes: [{ dest: 'fx mix', level: toward(c.mix > 0, c.rr(50, 80)) }] } : null,
        attack: c => ({ label: 'attack time (new notes)', routes: ['env1 attack', 'env2 attack'].map(dest => ({ dest, level: toward(c.env1.a > 300, c.rr(40, 70)) })) }),
        decay: c => ({ label: 'decay time (new notes)', routes: ['env1 decay', 'env2 decay'].map(dest => ({ dest, level: toward(c.env1.d > 2000, c.rr(40, 70)) })) }),
        release: c => ({ label: 'release time', routes: [{ dest: 'env1 release', level: toward(c.env1.r > 1500, c.rr(40, 70)) }] }),
        'unison detune': c => c.unison ? { label: 'unison detune', routes: [{ dest: 'unison detune', level: c.rr(50, 80) }] } : null,
        noise: c => ({ label: 'noise level', routes: [{ dest: 'noise level', level: c.rr(20, 40) }] }),
    }

    // ---- presets ------------------------------------------------------------
    const presets = [
        {
            name: 'Init patch',
            description: 'Resets to a plain single-oscillator patch: one osc into an open low-pass filter, a gate amp envelope, FX/drive bypassed. Useful as a clean starting point.',
            params: [
                { id: 'wave', label: 'Osc 1 wave', type: 'select', options: waveChoices, default: 'saw' },
                { id: 'cutoff', label: 'Cutoff (Hz, 10000 = open)', type: 'number', min: 20, max: 10000, default: 10000 },
                { id: 'clearMatrix', label: 'Clear mod matrix', type: 'bool', default: true },
                { id: 'level', label: 'Program level', type: 'number', min: 0, max: 100, default: 80 },
            ],
            generate(p, w) {
                w.comment('Voice')
                w.set('po', 'poly'); w.set('unvo', 'one voice/note'); w.set('unde', 0)
                w.set('poen', 'off'); w.set('andr', 0); w.set('ossyty', 'off'); w.set('fmam', 0)
                w.comment('Oscillators')
                for (const osc of [1, 2, 3]) {
                    setWave(w, osc, p.wave)
                    w.set(`os${osc}oc`, 0); w.set(`os${osc}tr`, 0); w.set(`os${osc}pi`, 0)
                }
                w.comment('Mixer: only osc 1 audible, everything to filter 1')
                w.set('os1le', 100); w.set('os2le', 0); w.set('os3le', 0)
                w.set('rile', 0); w.set('nole', 0); w.set('exle', 0)
                for (const b of ['os1ba', 'os2ba', 'os3ba', 'riba', 'noba', 'exba']) w.set(b, 0)
                w.comment('Filters')
                w.set('fi1ty', 'lowpass mg_4pole'); w.freq('fi1fr', p.cutoff); w.set('fi1re', 0)
                w.set('fi1ketr', 0); w.set('fi1enam', 0); w.set('fi1si', 'positive')
                w.set('fi2reto1', 'no'); w.set('fi2ty', 'bypass'); w.set('fi2enam', 0)
                w.set('fi1le', 100); w.set('fi2le', 0); w.set('prfile', 0); w.set('sele', 0)
                w.set('fi1pa', 0); w.set('fi2pa', 0)
                w.comment('Output / FX')
                w.set('drty', 'bypass'); w.set('drle', 0); w.set('prle', p.level)
                w.set('fxty0', 'bypass'); w.set('fx2ty', 'bypass')
                w.comment('Envelopes: gate shape')
                for (const e of [1, 2, 3]) {
                    w.set(`en${e}atti`, 0); w.set(`en${e}deti`, 0); w.set(`en${e}suti`, 255)
                    w.set(`en${e}sule`, 100); w.time(`en${e}reti`, 5)
                    w.set(`en${e}atsl`, 'linear'); w.set(`en${e}desl`, 'linear'); w.set(`en${e}resl`, 'linear')
                    w.set(`en${e}vetoen`, 0); w.set(`en${e}reevno`, 'on')
                    w.set(`en${e}frru`, 'off'); w.set(`en${e}lo`, 0)
                }
                if (p.clearMatrix) {
                    w.comment('Mod matrix cleared')
                    for (const n of range(1, 12)) w.cable(n, 'none', 'none', 0)
                }
            }
        },
        {
            name: 'Clear mod matrix',
            description: 'Disconnects a range of patch cables (source/destination none, level and offset 0).',
            params: [
                { id: 'from', label: 'From cable', type: 'number', min: 1, max: 12, default: 1 },
                { id: 'to', label: 'To cable', type: 'number', min: 1, max: 12, default: 12 },
            ],
            generate(p, w) {
                for (const n of range(Math.min(p.from, p.to), Math.max(p.from, p.to))) {
                    w.comment(`Cable ${n}`)
                    w.cable(n, 'none', 'none', 0)
                }
            }
        },
        {
            name: 'Mod route',
            description: 'Generic patch cable: any source to any destination with level and offset in percent.',
            params: [
                cableParam(),
                { id: 'source', label: 'Source', type: 'select', options: 'modsrc', default: 'velocity' },
                { id: 'dest', label: 'Destination', type: 'select', options: 'moddst', default: 'flt1 frq' },
                { id: 'level', label: 'Level %', type: 'number', min: -100, max: 100, step: 0.1, default: 30 },
                { id: 'offset', label: 'Offset %', type: 'number', min: -100, max: 100, step: 0.1, default: 0 },
            ],
            generate(p, w) {
                w.comment(`${p.source} -> ${p.dest}`)
                w.cable(p.cable, p.source, p.dest, p.level, p.offset)
            }
        },
        {
            name: 'Vibrato',
            description: 'LFO to pitch on a patch cable. Keep the depth small: a few percent is already a lot.',
            params: [
                cableParam(),
                { id: 'lfo', label: 'LFO', type: 'select', options: ['1', '2'], default: '1' },
                { id: 'wave', label: 'LFO wave', type: 'select', options: ['sin', 'tri'], default: 'sin' },
                { id: 'rate', label: 'Rate (Hz, 0.01-10)', type: 'number', min: 0.01, max: 10, step: 0.01, default: 5.5 },
                { id: 'depth', label: 'Depth %', type: 'number', min: 0, max: 100, step: 0.1, default: 3 },
                { id: 'reset', label: 'LFO reset', type: 'select', options: ['mono (per pgm)', 'poly (per voice)', 'key mono', 'key poly', 'legato mono', 'legato poly', 'tempo lock'], default: 'poly (per voice)' },
            ],
            generate(p, w) {
                w.comment(`Vibrato: lfo${p.lfo} ${p.wave} -> pitch`)
                w.set(`lf${p.lfo}tesy`, 'fixed rate')
                w.unit(`lf${p.lfo}rafr`, micronUnits.lfoRate, p.rate)
                w.set(`lf${p.lfo}re`, p.reset)
                w.cable(p.cable, `lfo${p.lfo} ${p.wave}`, 'pitch', p.depth)
            }
        },
        {
            name: 'LFO effect (tremolo / pan / wobble / PWM)',
            description: 'One LFO to a common target. Tremolo = program level, auto-pan = pan, wobble = filter 1 cutoff, PWM = osc 1 shape.',
            params: [
                cableParam(),
                { id: 'target', label: 'Effect', type: 'select', options: ['tremolo', 'auto-pan', 'filter wobble', 'PWM osc 1', 'PWM all oscs', 'FM wobble'], default: 'filter wobble' },
                { id: 'lfo', label: 'LFO', type: 'select', options: ['1', '2'], default: '2' },
                { id: 'wave', label: 'LFO wave', type: 'select', options: lfoWaves, default: 'tri' },
                ...lfoRateParams,
                { id: 'depth', label: 'Depth %', type: 'number', min: -100, max: 100, step: 0.1, default: 40 },
            ],
            generate(p, w) {
                const dests = {
                    'tremolo': ['program level'],
                    'auto-pan': ['pan'],
                    'filter wobble': ['flt1 frq'],
                    'PWM osc 1': ['osc1 shp'],
                    'PWM all oscs': ['osc1 shp', 'osc2 shp', 'osc3 shp'],
                    'FM wobble': ['fm amount'],
                }[p.target]
                w.comment(`${p.target}: lfo${p.lfo} ${p.wave}`)
                setLfoRate(w, p.lfo, p)
                dests.forEach((d, i) => {
                    const n = p.cable + i
                    if (n > 12) { w.comment(`No cable left for ${d}`); return }
                    w.cable(n, `lfo${p.lfo} ${p.wave}`, d, p.depth)
                })
            }
        },
        {
            name: 'Sample & hold random',
            description: 'Classic random stepped modulation from S&H, e.g. random filter "computer bleeps" or random pitch.',
            params: [
                cableParam(),
                { id: 'dest', label: 'Destination', type: 'select', options: ['flt1 frq', 'flt2 frq', 'pitch', 'pan', 'osc1 shp', 'flt1 res', 'fm amount'], default: 'flt1 frq' },
                { id: 'sync', label: 'Rate mode', type: 'select', options: ['fixed rate', 'follow tempo'], default: 'follow tempo' },
                { id: 'rate', label: 'Free rate (Hz, 0.01-10)', type: 'number', min: 0.01, max: 10, step: 0.01, default: 4 },
                { id: 'syncRate', label: 'Synced rate (x tempo)', type: 'select', options: 'syncrate', default: 'x1' },
                { id: 'smooth', label: 'Smoothing (0-100)', type: 'number', min: 0, max: 100, default: 0 },
                { id: 'depth', label: 'Depth %', type: 'number', min: -100, max: 100, step: 0.1, default: 35 },
            ],
            generate(p, w) {
                w.comment(`S&H -> ${p.dest}`)
                w.set('shtesy', p.sync)
                if (p.sync === 'follow tempo') w.set('shrasy', p.syncRate)
                else w.unit('shrafr', micronUnits.lfoRate, p.rate)
                w.set('shsm', p.smooth)
                w.cable(p.cable, 's/h', p.dest, p.depth)
            }
        },
        {
            name: 'Detuned stack (supersaw)',
            description: 'All three oscillators on the same wave, spread in cents around osc 1, with optional octave offsets, unison and analog drift.',
            params: [
                { id: 'wave', label: 'Wave', type: 'select', options: waveChoices, default: 'saw' },
                { id: 'detune', label: 'Detune (cents)', type: 'number', min: 0, max: 100, default: 12 },
                { id: 'oct2', label: 'Osc 2 octave', type: 'number', min: -3, max: 3, default: 0 },
                { id: 'oct3', label: 'Osc 3 octave', type: 'number', min: -3, max: 3, default: 0 },
                { id: 'unison', label: 'Unison', type: 'select', options: ['one voice/note', '2 voices/note', '4 voices/note', 'all voices/note'], default: 'one voice/note' },
                { id: 'unDetune', label: 'Unison detune', type: 'number', min: 0, max: 100, default: 20 },
                { id: 'drift', label: 'Analog drift', type: 'number', min: 0, max: 100, default: 15 },
            ],
            generate(p, w) {
                const pitches = [0, p.detune, -p.detune]
                const octs = [0, p.oct2, p.oct3]
                for (const osc of [1, 2, 3]) {
                    w.comment(`Osc ${osc}`)
                    setWave(w, osc, p.wave)
                    w.set(`os${osc}oc`, octs[osc - 1])
                    w.set(`os${osc}tr`, 0)
                    w.set(`os${osc}pi`, pitches[osc - 1])
                    w.set(`os${osc}le`, 80)
                }
                w.comment('Voice')
                w.set('ossyty', 'off'); w.set('fmam', 0)
                w.set('unvo', p.unison); w.set('unde', p.unDetune); w.set('andr', p.drift)
            }
        },
        {
            name: 'Chord stack',
            description: 'Tunes osc 2 and osc 3 to intervals above osc 1 so a single key plays a chord. Osc 1 is the root.',
            params: [
                { id: 'chord', label: 'Chord', type: 'select', options: ['octaves', 'power (5th + oct)', 'major', 'minor', 'sus2', 'sus4', 'diminished', 'augmented', 'minor 7 (no 5th)', 'major 7 (no 5th)'], default: 'minor' },
                { id: 'rootOct', label: 'Root octave', type: 'number', min: -3, max: 3, default: 0 },
                { id: 'level', label: 'Osc levels', type: 'number', min: 0, max: 100, default: 75 },
            ],
            generate(p, w) {
                const intervals = {
                    'octaves': [12, -12], 'power (5th + oct)': [7, 12], 'major': [4, 7], 'minor': [3, 7],
                    'sus2': [2, 7], 'sus4': [5, 7], 'diminished': [3, 6], 'augmented': [4, 8],
                    'minor 7 (no 5th)': [3, 10], 'major 7 (no 5th)': [4, 11],
                }[p.chord]
                const semis = [0, ...intervals]
                semis.forEach((s, i) => {
                    const osc = i + 1
                    const { oct, tr } = semitonesToOctTr(s)
                    w.comment(`Osc ${osc}: +${s} semitones`)
                    w.set(`os${osc}oc`, clamp(oct + p.rootOct, -3, 3))
                    w.set(`os${osc}tr`, tr)
                    w.set(`os${osc}pi`, 0)
                    w.set(`os${osc}le`, p.level)
                })
                w.set('ossyty', 'off'); w.set('fmam', 0)
            }
        },
        {
            name: 'Envelope shape',
            description: 'Typical envelope shapes. Envelope 1 is the amp envelope, envelope 2 drives the filter envelope amount, envelope 3 is free for modulation. Time scale multiplies all segment times (200 % = twice as long).',
            params: [
                { id: 'env', label: 'Envelope', type: 'select', options: ['1', '2', '3'], default: '1' },
                { id: 'shape', label: 'Shape', type: 'select', options: ['organ', 'gate', 'pluck', 'percussive', 'keys', 'brass', 'pad', 'swell', 'reverse swell'], default: 'pluck' },
                { id: 'scale', label: 'Time scale %', type: 'number', min: 10, max: 1000, default: 100 },
                { id: 'slope', label: 'Slopes', type: 'select', options: ['linear', '+exp', '-exp'], default: 'linear' },
                { id: 'vel', label: 'Velocity sens.', type: 'number', min: 0, max: 100, default: 0 },
            ],
            generate(p, w) {
                // [attack ms, decay ms, sustain level, release ms]
                const shapes = {
                    'organ': [1, 0, 100, 15], 'gate': [0, 0, 100, 2],
                    'pluck': [0, 300, 0, 250], 'percussive': [0, 800, 0, 800],
                    'keys': [0, 1500, 40, 400], 'brass': [60, 400, 70, 250],
                    'pad': [800, 2000, 80, 2500], 'swell': [3000, 0, 100, 2000],
                    'reverse swell': [2500, 0, 0, 5],
                }
                const [a, d, s, r] = shapes[p.shape]
                const t = ms => ms * p.scale / 100
                const e = p.env
                w.comment(`Envelope ${e}: ${p.shape}`)
                w.time(`en${e}atti`, t(a)); w.time(`en${e}deti`, t(d))
                w.comment('sustain time 255 = max (30 s)')
                w.set(`en${e}suti`, 255); w.set(`en${e}sule`, s); w.time(`en${e}reti`, t(r))
                w.set(`en${e}atsl`, p.slope); w.set(`en${e}desl`, p.slope); w.set(`en${e}resl`, p.slope)
                w.set(`en${e}vetoen`, p.vel)
                w.set(`en${e}lo`, 0); w.set(`en${e}frru`, 'off')
            }
        },
        {
            name: 'Filter envelope sweep',
            description: 'Sets filter 1 plus envelope 2 for plucky or sweeping filter movement. A negative envelope amount sweeps downwards.',
            params: [
                { id: 'type', label: 'Filter type', type: 'select', options: 'filtertype', default: 'lowpass mg_4pole' },
                { id: 'cutoff', label: 'Cutoff (Hz)', type: 'number', min: 20, max: 10000, default: 400 },
                { id: 'res', label: 'Resonance', type: 'number', min: 0, max: 100, default: 40 },
                { id: 'amount', label: 'Env amount', type: 'number', min: -100, max: 100, default: 60 },
                { id: 'keytrack', label: 'Key track', type: 'number', min: -100, max: 200, default: 50 },
                { id: 'attack', label: 'Env attack (ms)', type: 'number', min: 0, max: 30000, step: 0.1, default: 0 },
                { id: 'decay', label: 'Env decay (ms)', type: 'number', min: 0, max: 30000, step: 0.1, default: 300 },
                { id: 'sustain', label: 'Env sustain', type: 'number', min: -100, max: 100, default: 0 },
                { id: 'release', label: 'Env release (ms)', type: 'number', min: 0, max: 30000, step: 0.1, default: 250 },
                { id: 'vel', label: 'Velocity sens.', type: 'number', min: 0, max: 100, default: 30 },
            ],
            generate(p, w) {
                w.comment('Filter 1')
                w.set('fi1ty', p.type); w.freq('fi1fr', p.cutoff); w.set('fi1re', p.res)
                w.set('fi1enam', p.amount); w.set('fi1ketr', p.keytrack)
                w.comment('Envelope 2 (filter)')
                w.time('en2atti', p.attack); w.time('en2deti', p.decay); w.set('en2suti', 255)
                w.set('en2sule', p.sustain); w.time('en2reti', p.release); w.set('en2vetoen', p.vel)
                w.set('en2lo', 0); w.set('en2frru', 'off')
            }
        },
        {
            name: 'Looping envelope as LFO',
            description: 'Loops envelope 3 to get an LFO-like shape (ramps, triangles, rhythmic pulses) and routes it to a destination.',
            params: [
                cableParam(),
                { id: 'dest', label: 'Destination', type: 'select', options: 'moddst', default: 'flt1 frq' },
                { id: 'shape', label: 'Shape', type: 'select', options: ['ramp up', 'ramp down', 'triangle', 'pulse'], default: 'triangle' },
                { id: 'speed', label: 'Segment time (ms)', type: 'number', min: 0, max: 30000, step: 0.1, default: 250 },
                { id: 'depth', label: 'Depth %', type: 'number', min: -100, max: 100, step: 0.1, default: 40 },
            ],
            generate(p, w) {
                const t = p.speed
                const [a, d] = { 'ramp up': [t, 0], 'ramp down': [0, t], 'triangle': [t, t], 'pulse': [0, 0] }[p.shape]
                w.comment(`Envelope 3 looping: ${p.shape}`)
                w.time('en3atti', a); w.time('en3deti', d)
                w.time('en3suti', p.shape === 'pulse' ? t : 0)
                w.set('en3sule', 0); w.time('en3reti', p.shape === 'pulse' ? t : 0)
                w.set('en3atsl', 'linear'); w.set('en3desl', 'linear')
                w.comment('en3lo: 0=off, 1=attack/decay, 2=entire envelope, 3=while note held')
                w.set('en3lo', p.shape === 'pulse' ? 2 : 1)
                w.cable(p.cable, 'env 3', p.dest, p.depth)
            }
        },
        {
            name: 'Tracking curve',
            description: 'Fills the tracking generator points -16..16 with a curve. The tracking output is the "track" mod source. Span 12 uses points -12..12 and holds the end values beyond them.',
            params: [
                { id: 'shape', label: 'Curve', type: 'select', options: ['linear', 'exponential', 'logarithmic', 'S-curve', 'V (absolute)', 'staircase', 'sine wave', 'random', 'flat (zero)'], default: 'exponential' },
                { id: 'amount', label: 'Amount %', type: 'number', min: 0, max: 100, default: 100 },
                { id: 'invert', label: 'Invert', type: 'bool', default: false },
                { id: 'span', label: 'Span', type: 'select', options: ['16', '12'], default: '16' },
                { id: 'steps', label: 'Steps / cycles', type: 'number', min: 1, max: 16, default: 4 },
                { id: 'seed', label: 'Random seed', type: 'number', min: 0, max: 999999, default: () => Math.floor(Math.random() * 1000000) },
                { id: 'cable', label: 'Route "track" to cable # (0 = none)', type: 'number', min: 0, max: 12, default: 0 },
                { id: 'dest', label: 'Route destination', type: 'select', options: 'moddst', default: 'flt1 frq' },
            ],
            generate(p, w) {
                const span = Number(p.span)
                const rnd = mulberry32(p.seed)
                const curve = {
                    'linear': t => t,
                    'exponential': t => 2 * ((t + 1) / 2) ** 2 - 1,
                    'logarithmic': t => 2 * Math.sqrt((t + 1) / 2) - 1,
                    'S-curve': t => { const u = (t + 1) / 2; return 2 * u * u * (3 - 2 * u) - 1 },
                    'V (absolute)': t => 2 * Math.abs(t) - 1,
                    'staircase': t => clamp(Math.round(t * p.steps) / p.steps, -1, 1),
                    'sine wave': t => Math.sin(t * Math.PI * p.steps),
                    'random': () => rnd() * 2 - 1,
                    'flat (zero)': () => 0,
                }[p.shape]
                w.comment(`Tracking curve: ${p.shape}${p.invert ? ' (inverted)' : ''}, amount ${p.amount}%`)
                for (const x of range(-16, 16)) {
                    const t = clamp(x / span, -1, 1)
                    let y = curve(t) * p.amount
                    if (p.invert) y = -y
                    w.set(x < 0 ? `trpom${-x}` : `trpo${x}`, clamp(y, -100, 100))
                }
                if (p.cable > 0) {
                    w.comment(`track -> ${p.dest}`)
                    w.cable(p.cable, 'track', p.dest, 50)
                }
            }
        },
        {
            name: 'Effects',
            description: 'Quick setup for drive and the two FX slots.',
            params: [
                { id: 'drive', label: 'Drive type', type: 'select', options: ['bypass', 'compressor', 'rms limiter', 'tube overdrive', 'distortion', 'tube amp', 'fuzz pedal'], default: 'tube overdrive' },
                { id: 'driveLevel', label: 'Drive level', type: 'number', min: 0, max: 100, default: 30 },
                { id: 'fx1', label: 'FX 1', type: 'select', options: ['bypass', 'chorus', 'flanger theta', 'flanger thru-0', 'phaser super', 'phaser string', 'vocoder 40-band'], default: 'chorus' },
                { id: 'fx2', label: 'FX 2', type: 'select', options: ['bypass', 'delay mono', 'delay stereo', 'delay split L/R', 'reverb hall', 'reverb plate', 'reverb room'], default: 'reverb hall' },
                { id: 'mix', label: 'FX mix (-50..50)', type: 'number', min: -50, max: 50, default: 0 },
                { id: 'balance', label: 'FX balance (-50..50)', type: 'number', min: -50, max: 50, default: 0 },
            ],
            generate(p, w) {
                w.set('drty', p.drive); w.set('drle', p.driveLevel)
                w.set('fxty0', p.fx1); w.set('fx2ty', p.fx2)
                w.set('fxmi', p.mix); w.set('fxba', p.balance)
            }
        },
        {
            name: 'Random patch',
            description: 'Builds a complete patch from musical building blocks (oscillator recipe, filter + envelope sweep, amp envelope, LFO effects, drive and FX) tuned to the chosen sound type, and maps M1/M2 to useful parameters. Same seed + type = same patch. FX parameters a-h are left as they are.',
            params: [
                { id: 'type', label: 'Sound type', type: 'select', options: Object.keys(soundProfiles), default: 'pad' },
                { id: 'seed', label: 'Seed', type: 'number', min: 0, max: 999999, default: () => Math.floor(Math.random() * 1000000) },
                { id: 'mod', label: 'Modulation %', type: 'number', min: 0, max: 200, default: 50 },
                { id: 'fx', label: 'Effects', type: 'bool', default: true },
            ],
            generate(p, w) {
                const prof = soundProfiles[p.type]
                const rnd = mulberry32(p.seed)
                const rr = (lo, hi) => lo + rnd() * (hi - lo)
                const ri = ([lo, hi]) => Math.round(rr(lo, hi))
                const int = ([lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1))
                const rlog = ([lo, hi]) => lo * Math.pow(hi / lo, rnd()) // for times / frequencies
                const pick = arr => arr[Math.floor(rnd() * arr.length)]
                const chance = prob => rnd() < prob
                const pickW = weights => {
                    const entries = Object.entries(weights).filter(([, wt]) => wt > 0)
                    let t = rnd() * entries.reduce((s, [, wt]) => s + wt, 0)
                    for (const [k, wt] of entries) if ((t -= wt) < 0) return k
                    return entries[entries.length - 1][0]
                }
                w.comment(`Random ${p.type}, seed ${p.seed}`)

                // ---- decisions ----
                const mono = chance(prof.mono)
                const porta = mono && chance(prof.porta)
                const unison = chance(prof.unison)

                // Oscillators: octaves within -2..0
                const base = pick(prof.octave)
                const oct = o => clamp(o, -2, 0)
                const shapes = { 'tri/saw': [20, 100], pulse: [-60, 60], sine: [0, 30], ...prof.shapes }
                const shapeFor = wave => int(shapes[wave])
                const osc = (wave, octave, level, pitch = 0) => ({ wave, shape: shapeFor(wave), oct: oct(octave), level, pitch })
                const off = () => ({ wave: 'tri/saw', shape: 100, oct: oct(base), level: 0, pitch: 0 })
                const recipe = pickW(prof.osc)
                const w1 = pickW(prof.waves)
                const nextWave = () => chance(0.7) ? w1 : pickW(prof.waves)
                const detune = () => ri(prof.detune) * (chance(0.5) ? 1 : -1)
                let oscs, sync = 'off', fmAmount = 0, envToFm = false, envToSync = false
                switch (recipe) {
                    case 'single':
                        oscs = [osc(w1, base, 100), off(), off()]
                        break
                    case 'detuned pair':
                        oscs = [osc(w1, base, 90), osc(nextWave(), base, 80, detune()), off()]
                        break
                    case 'detuned trio': {
                        const d = ri(prof.detune)
                        oscs = [osc(w1, base, 80), osc(nextWave(), base, 75, d), osc(nextWave(), chance(0.5) ? base - 1 : base, 75, -d)]
                        break
                    }
                    case 'octave stack': {
                        const low = base - 1 >= -2 ? base - 1 : base + 1 // keep two different octaves within -2..0
                        oscs = [osc(w1, base, 90), osc(nextWave(), low, 70, int([2, 6])),
                            chance(0.4) && base - 2 >= -2 ? osc(nextWave(), base - 2, 40, -int([2, 6])) : off()]
                        break
                    }
                    case 'fm':
                        // osc 2 is a (mostly silent) sine modulator; an env 3 decay gives a bright attack
                        oscs = [osc(pick(['sine', 'tri/saw']), base, 100), osc('sine', base, chance(0.3) ? int([10, 30]) : 0), off()]
                        oscs[0].shape = oscs[0].wave === 'sine' ? 0 : int([0, 40])
                        oscs[1].shape = 0
                        fmAmount = ri(prof.fm || [100, 300])
                        envToFm = true
                        break
                    case 'sync':
                        // hard sync: osc 2 is the audible slave, its pitch swept by env 3
                        oscs = [osc('tri/saw', base, int([0, 30])), osc(pick(['tri/saw', 'pulse']), base, 100, int([300, 999])), off()]
                        sync = 'hard 2 to 1'
                        envToSync = true
                        break
                }
                // Mixer gain staging: loudest audible osc at 100, ratios kept
                const loudestOsc = Math.max(...oscs.map(o => o.level))
                for (const o of oscs) o.level = Math.round(o.level * 100 / loudestOsc)
                const audible = [1, 2, 3].filter(n => oscs[n - 1].level > 0)
                const shapedOscs = audible.filter(n => oscs[n - 1].wave !== 'sine')

                const filterType = pickW(prof.filter)
                // Never start below the lowest oscillator's fundamental (4-pole filters would
                // leave almost nothing)
                const lowestF0 = MIDDLE_C * 2 ** Math.min(...oscs.filter(o => o.level > 0).map(o => o.oct))
                const cutoff = Math.max(rlog(prof.cutoff), lowestF0 * 1.5)
                const res = ri(prof.res)
                const fenvAmount = ri(prof.fenvAmount)
                const drive = p.fx ? pickW(prof.drive) : 'bypass'
                const driveLevel = drive === 'bypass' ? 0 : ri(prof.driveLevel)
                const fx1 = p.fx ? pickW(prof.fx1) : 'bypass'
                const fx2 = p.fx ? pickW(prof.fx2) : 'bypass'
                const mix = ri(prof.mix)
                const fxActive = fx1 !== 'bypass' || fx2 !== 'bypass'

                const makeEnv = (e, vel, fixedSlope) => ({
                    a: rlog(e.a), d: rlog(e.d), s: ri(e.s), r: rlog(e.r), vel,
                    slope: fixedSlope || pickW({ linear: 2, '+exp': 1, '-exp': 1 })
                })
                const env1 = makeEnv(prof.amp, ri(prof.vel), prof.ampSlope)
                const env2 = makeEnv(prof.fenv, ri(prof.fvel || prof.vel))
                const env3 = makeEnv({ a: [0.5, 2], d: [100, 800], s: [0, 0], r: [100, 800] }, 0)

                // LFO effects, one per LFO. They are chosen regardless of Modulation %
                // so the sliders can use them; Modulation % only scales the depth.
                const lfos = []
                const pool = { ...prof.lfo }
                if (!shapedOscs.length) delete pool.shape
                for (const lfo of [1, 2].slice(0, int(prof.lfoCount))) {
                    if (!Object.keys(pool).length) break
                    const name = pickW(pool)
                    delete pool[name]
                    const fx = lfoEffects[name]
                    const rate = rr(...fx.rate) * (fx.slow ? prof.lfoRate : 1)
                    lfos.push({ lfo, name, wave: pick(fx.waves), rate, depth: rr(...fx.depth), reset: fx.reset, dests: fx.dests({ shapedOscs }) })
                }

                // M1 / M2
                const ctx = { rr, cutoff, res, fenvAmount, lfos, oscs, shapedOscs, drive, fxActive, mix, env1, unison }
                const chooseSlider = (weights, exclude) => {
                    const options = Object.fromEntries(Object.entries(weights).filter(([k, wt]) => wt > 0 && !exclude.includes(k)))
                    while (Object.keys(options).length) {
                        const key = pickW(options)
                        const target = sliderTargets[key](ctx)
                        if (target) return { key, ...target }
                        delete options[key]
                    }
                    return { key: 'cutoff', ...sliderTargets.cutoff(ctx) }
                }
                const m1 = chooseSlider(prof.m1, [])
                // The M1-controlled LFO is scaled only by the M1 slider (influence 100):
                // its cable keeps the effect's plain depth. The others follow the sound
                // type and Modulation %.
                for (const l of lfos) if (m1.influence !== l.lfo) l.depth *= prof.mod * p.mod / 100
                const m2 = chooseSlider(prof.m2, [m1.key, 'lfo depth'])

                // ---- write ----
                w.comment('Voice')
                w.set('po', mono ? 'mono' : 'poly')
                w.set('unvo', unison ? '2 voices/note' : 'one voice/note'); w.set('unde', unison ? int(prof.unisonDetune || [10, 30]) : 0)
                w.set('poen', porta ? 'legato only' : 'off')
                if (porta) { w.set('poty', 'fixed'); w.unit('poti', micronUnits.portaTime, rlog([30, 200])) }
                w.set('andr', ri(prof.drift))
                w.set('ossyty', sync)
                w.set('fmty', 'lin 2 > 1'); w.set('fmam', fmAmount)

                w.comment(`Oscillators: ${recipe}`)
                oscs.forEach((o, i) => {
                    const n = i + 1
                    w.set(`os${n}wa`, o.wave); w.set(`os${n}wash`, o.shape)
                    w.set(`os${n}oc`, o.oct); w.set(`os${n}tr`, 0); w.set(`os${n}pi`, o.pitch)
                })

                w.comment('Mixer')
                oscs.forEach((o, i) => w.set(`os${i + 1}le`, o.level))
                w.set('rile', 0); w.set('exle', 0)
                w.set('nole', prof.noise && chance(prof.noise) ? int([3, 10]) : 0)
                for (const b of ['os1ba', 'os2ba', 'os3ba', 'riba', 'noba', 'exba']) w.set(b, 0)

                w.comment('Filter 1 (filter 2 off)')
                w.set('fi1ty', filterType); w.freq('fi1fr', cutoff); w.set('fi1re', res)
                w.set('fi1ketr', ri(prof.keytrack)); w.set('fi1enam', fenvAmount); w.set('fi1si', 'positive')
                w.set('fi2reto1', 'no'); w.set('fi2ty', 'bypass'); w.set('fi2enam', 0)
                w.set('fi1le', 100); w.set('fi2le', 0); w.set('prfile', 0); w.set('sele', 0)
                w.set('fi1pa', 0); w.set('fi2pa', 0)

                const writeEnv = (n, e) => {
                    w.time(`en${n}atti`, e.a); w.time(`en${n}deti`, e.d)
                    w.set(`en${n}suti`, 255); w.set(`en${n}sule`, e.s); w.time(`en${n}reti`, e.r)
                    w.set(`en${n}atsl`, 'linear'); w.set(`en${n}desl`, e.slope); w.set(`en${n}resl`, e.slope)
                    w.set(`en${n}vetoen`, e.vel); w.set(`en${n}reevno`, 'on')
                    w.set(`en${n}frru`, 'off'); w.set(`en${n}lo`, 0)
                }
                w.comment('Envelope 1: amp')
                writeEnv(1, env1)
                w.comment('Envelope 2: filter')
                writeEnv(2, env2)
                w.comment('Envelope 3: short decay for FM / sync sweeps')
                writeEnv(3, env3)

                let cable = 1
                const route = (src, dst, level) => {
                    if (cable > 12) { w.comment(`No cable left for ${src} -> ${dst}`); return }
                    w.cable(cable++, src, dst, clamp(level, -100, 100))
                }
                w.comment('LFOs (m1slin = M1 slider influence on the LFO depth, 0 = none)')
                for (const l of [1, 2]) {
                    const fx = lfos.find(x => x.lfo === l)
                    w.set(`lf${l}tesy`, 'fixed rate')
                    w.unit(`lf${l}rafr`, micronUnits.lfoRate, fx ? fx.rate : 1)
                    w.set(`lf${l}re`, fx ? fx.reset : 'poly (per voice)')
                    w.set(`m1slin${l}`, m1.influence === l ? 100 : 0)
                }

                w.comment('Mod matrix')
                for (const l of lfos.filter(x => x.depth > 0)) {
                    w.comment(`${l.name}: lfo ${l.lfo}`)
                    l.dests.forEach(d => route(`lfo${l.lfo} ${l.wave}`, d, +l.depth.toFixed(1)))
                }
                if (envToFm) { w.comment('FM decay'); route('env 3', 'fm amount', int([20, 40])) }
                if (envToSync) { w.comment('Sync sweep'); route('env 3', 'osc2 pitch', int([10, 30])) }
                w.comment(`M1: ${m1.label}`)
                m1.routes.forEach(r => route('m1slider', r.dest, +r.level.toFixed(1)))
                w.comment(`M2: ${m2.label}`)
                m2.routes.forEach(r => route('m2slider', r.dest, +r.level.toFixed(1)))
                while (cable <= 12) w.cable(cable++, 'none', 'none', 0)

                w.comment('Drive / FX (fx mix: -50 dry .. 50 wet)')
                w.set('drty', drive); w.set('drle', driveLevel)
                w.set('fxty0', fx1); w.set('fx2ty', fx2)
                if (fxActive) { w.set('fxmi', mix); w.set('fxba', 0) }
                const loudness = estimateLoudness({ oscs, filterType, cutoff, res, fenvAmount, env1, env2, unison, drive, driveLevel })
                const level = clamp(Math.round(LEVEL_REF * 10 ** (LOUDNESS_COMPENSATION * (LOUDNESS_REF - loudness) / 20)), 20, 100)
                w.comment(`Program level normalized for loudness (estimate ${loudness.toFixed(1)} dB)`)
                w.set('prle', level)
                w.set('prca', prof.category)
            }
        },
        {
            name: 'Randomize',
            description: 'Random values in musically safe ranges for the chosen sections. The same seed always gives the same script, so you can get a result back.',
            params: [
                { id: 'seed', label: 'Seed', type: 'number', min: 0, max: 999999, default: () => Math.floor(Math.random() * 1000000) },
                { id: 'osc', label: 'Oscillators', type: 'bool', default: true },
                { id: 'mixer', label: 'Mixer', type: 'bool', default: true },
                { id: 'filter', label: 'Filters', type: 'bool', default: true },
                { id: 'env', label: 'Envelopes', type: 'bool', default: true },
                { id: 'lfo', label: 'LFOs', type: 'bool', default: true },
                { id: 'mods', label: 'Random mod cables', type: 'number', min: 0, max: 12, default: 3 },
                { id: 'firstCable', label: 'Starting at cable #', type: 'number', min: 1, max: 12, default: 1 },
            ],
            generate(p, w) {
                const rnd = mulberry32(p.seed)
                const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
                const pick = arr => arr[Math.floor(rnd() * arr.length)]
                const chance = prob => rnd() < prob
                w.comment(`Random seed ${p.seed}`)
                if (p.osc) {
                    w.comment('Oscillators')
                    for (const osc of [1, 2, 3]) {
                        w.set(`os${osc}wa`, pick(['sine', 'tri/saw', 'tri/saw', 'pulse']))
                        w.set(`os${osc}wash`, int(-100, 100))
                        w.set(`os${osc}oc`, osc === 1 ? 0 : pick([-1, 0, 0, 1]))
                        w.set(`os${osc}tr`, osc === 1 ? 0 : pick([0, 0, 0, 7, -5, 5]))
                        w.set(`os${osc}pi`, osc === 1 ? 0 : int(-20, 20))
                    }
                    w.set('ossyty', pick(['off', 'off', 'off', 'hard 2 to 1', 'soft 2 to 1']))
                    w.set('fmam', chance(0.3) ? int(0, 300) : 0)
                }
                if (p.mixer) {
                    w.comment('Mixer')
                    w.set('os1le', int(60, 100)); w.set('os2le', int(30, 100)); w.set('os3le', int(0, 90))
                    w.set('rile', chance(0.25) ? int(0, 50) : 0)
                    w.set('nole', chance(0.25) ? int(0, 25) : 0)
                }
                if (p.filter) {
                    w.comment('Filters')
                    w.set('fi1ty', pick(['lowpass ob_2pole', 'lowpass tb_3pole', 'lowpass mg_4pole', 'lowpass rp_4pole', 'lowpass jp_4pole', 'lowpass al_8pole', 'bandpass ob_2pol', 'highpass ob_2pol', 'vocal formant 1', 'comb 1']))
                    w.set('fi1fr', int(150, 900)); w.set('fi1re', int(0, 75))
                    w.set('fi1enam', int(-40, 80)); w.set('fi1ketr', int(0, 100))
                }
                if (p.env) {
                    w.comment('Envelopes')
                    for (const e of [1, 2, 3]) {
                        w.set(`en${e}atti`, chance(0.6) ? int(0, 20) : int(20, 180))
                        w.set(`en${e}deti`, int(10, 200))
                        w.set(`en${e}suti`, 255)
                        w.set(`en${e}sule`, int(0, 100))
                        w.set(`en${e}reti`, int(5, 170))
                    }
                }
                if (p.lfo) {
                    w.comment('LFOs')
                    for (const l of [1, 2]) {
                        w.set(`lf${l}tesy`, 'fixed rate')
                        w.set(`lf${l}rafr`, int(300, 1000))
                    }
                }
                if (p.mods > 0) {
                    const sources = ['lfo1 sin', 'lfo1 tri', 'lfo2 tri', 'lfo2 saw', 'env 3', 'env 2', 'velocity', 'random voice', 's/h', 'keytrack', 'm1slider', 'aftertch']
                    const dests = ['flt1 frq', 'flt1 res', 'osc1 shp', 'osc2 shp', 'osc3 shp', 'pan', 'fm amount', 'osc2 nar', 'flt2 frq', 'drive level', 'fx mix', 'lfo1 rate']
                    for (const i of range(0, p.mods - 1)) {
                        const n = p.firstCable + i
                        if (n > 12) break
                        const src = pick(sources), dst = pick(dests)
                        w.comment(`Cable ${n}: ${src} -> ${dst}`)
                        w.cable(n, src, dst, int(-300, 300) / 10)
                    }
                }
            }
        },
    ]

    // ---- UI -----------------------------------------------------------------
    let optionRefs = {}

    function resolveOptions(options) {
        return typeof options === 'string' ? optionRefs[options] : options
    }

    function renderParams(preset) {
        document.getElementById('preset-description').textContent = preset.description
        const root = document.getElementById('preset-params')
        root.innerHTML = ''
        preset.params.forEach(param => {
            const label = document.createElement('label')
            label.className = 'preset-param'
            label.append(param.label)
            const def = typeof param.default === 'function' ? param.default() : param.default
            let input
            if (param.type === 'select') {
                input = document.createElement('select')
                resolveOptions(param.options).forEach(o => {
                    const opt = document.createElement('option')
                    opt.value = opt.textContent = o
                    input.append(opt)
                })
                input.value = def
            } else if (param.type === 'bool') {
                input = document.createElement('input')
                input.type = 'checkbox'
                input.checked = def
                label.classList.add('preset-param-bool')
            } else {
                input = document.createElement('input')
                input.type = 'number'
                input.min = param.min
                input.max = param.max
                input.step = param.step || 1
                input.value = def
            }
            input.dataset.paramId = param.id
            if (typeof param.default === 'function') {
                // Randomized default (seeds): add a button to roll a new value
                const row = document.createElement('span')
                row.className = 'preset-param-row'
                const roll = document.createElement('button')
                roll.type = 'button'
                roll.className = 'preset-roll'
                roll.title = 'Roll a new value'
                roll.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
                    + '<rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>'
                    + [[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="currentColor"/>`).join('')
                    + '</svg>'
                roll.setAttribute('aria-label', 'Roll a new value')
                roll.addEventListener('click', e => { e.preventDefault(); input.value = param.default() })
                row.append(input, roll)
                label.append(row)
            } else {
                label.append(input)
            }
            root.append(label)
        })
    }

    function readParams(preset) {
        const values = {}
        preset.params.forEach(param => {
            const input = document.querySelector(`#preset-params [data-param-id="${param.id}"]`)
            if (param.type === 'bool') values[param.id] = input.checked
            else if (param.type === 'select') values[param.id] = input.value
            else values[param.id] = clamp(Number(input.value) || 0, param.min, param.max)
        })
        return values
    }

    function selectedPreset() {
        return presets[Number(document.getElementById('preset-select').value)]
    }

    function init(optionref) {
        optionRefs = optionref
        const select = document.getElementById('preset-select')
        select.innerHTML = presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')
        select.addEventListener('change', () => renderParams(selectedPreset()))
        renderParams(presets[0])
    }

    function generate(append) {
        const preset = selectedPreset()
        const w = writer()
        w.comment(`Preset: ${preset.name}`)
        preset.generate(readParams(preset), w)
        const textarea = document.getElementById('automation')
        const script = w.lines.join('\n')
        textarea.value = append && textarea.value.trim() ? textarea.value.trimEnd() + '\n\n' + script : script
    }

    return { init, generate, presets }
})()
