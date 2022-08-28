// Copyrights 2022 by Joonas Salonpää. MIT license
const midi = {
    getDevices: function (callback) {
        if (this.devices !== undefined) {
            callback(this.devices);
            return;
        }
        navigator.requestMIDIAccess({ sysex: true }).then(midiAccess => {
            const devices = [];
            midiAccess.outputs.forEach(o => devices.push(o));
            this.devices = devices;
            callback(devices);
        });
    },
    setDevice: function (name, onDone) {
        this.getDevices(devices => {
            this.device = devices.find(d => d.name === name);
            onDone(this.device !== undefined);
        });
    },
    noteOn: function (note, channel, velocity) {
        var midiCmd = 0b10010000;
        if (note < 128 && note >= 0) {
            this.midiCmd([midiCmd | channel, note, velocity !== undefined ? velocity : 127]);
        }
    },
    noteOff: function (note, channel) {
        var midiCmd = 0b10000000;
        if (note < 128 && note >= 0) {
            this.midiCmd([midiCmd | channel, note, 0]);
        }
    },
    midiCmd: function (cmd) {
        setTimeout(() => this.device.send(cmd), 0);
    }
}

function createNrpnParam (num) {
    let ch = 0
    const range = {min:0, max:100}
    let cachedValue = undefined
    return {
        setChannel: c => ch = c,
        send: (value, scaler) => {
            value = scaler ? scaler(value) : range.min + (range.max - range.min) * value
            value = Math.floor(value)
            value = Math.min(value, (1 << 13) - 1)
            value = Math.max(value, ~((1 << 13) - 1))

            if (cachedValue === value)
                return
            cachedValue = value

            const cc = (ccnum, ccval) => [0xB0 | ch, ccnum, ccval]
            midi.midiCmd(cc(98, num & 0x7F))
            midi.midiCmd(cc(99, (num >> 7) & 0x7F))
            midi.midiCmd(cc(38, value & 0x7F))
            midi.midiCmd(cc(6, (value >> 7) & 0x7F))
        },
        name: 'unknown',
        getRange: () => range,
        clearCache: () => cachedValue = undefined
    }
}

function mapNrpnParamArray(arr) {
    return arr.map(param => {
        const nrpn = createNrpnParam(Number(param.num))
        nrpn.name = param.name
        nrpn.options = param.options
        const range = nrpn.getRange()
        range.min = Number(param.tmin)
        range.max = Number(param.tmax)
        return nrpn
    })
}