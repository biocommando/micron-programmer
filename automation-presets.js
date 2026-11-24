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
                w.set('aren', 0)
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
            label.append(input)
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
