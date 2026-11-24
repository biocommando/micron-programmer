# Alesis Micron / MiniAk editor

A browser-based editor for the Alesis Micron (and MiniAk). It controls all of the synth's MIDI-controllable parameters over NRPN. You can write and run automation scripts, or generate complete patches from musical building blocks.

**Open the editor:** https://biocommando.github.io/micron-programmer/

Nothing to install: it runs in any browser that supports Web MIDI (Chrome, Edge, Opera, or Firefox with MIDI access allowed). The browser asks for MIDI permission on first use.

## Getting started

1. Connect the Micron to your computer with a MIDI interface.
2. Open the editor and pick your MIDI output and the Micron's MIDI channel at the top of the page. Both are remembered, and the device is reselected automatically the next time it's connected.
3. Turn the knobs or change the dropdowns. Every change is sent to the Micron right away.

The editor only sends, it can't read the current patch back from the synth. Edits go to the program being played on the Micron. Save it on the synth if you want to keep it.

The editor doesn't resend a value it has already sent. If you've changed parameters on the synth itself, press **Clear cached values** so everything is sent again.

## Parameters

The controls are grouped like on the synth: misc/voice, mixer, oscillators, filters, envelopes, LFOs, FX, the modulation matrix (12 patch cables) and tracking. Where the Micron uses real-world units, the knobs show them: envelope and portamento times in ms/s, and filter frequencies and LFO/S&H rates in Hz.

## Automation editor

The automation editor runs a script of parameter changes in one go. Each parameter has a short name; the full list is under **List of short names** at the bottom of the page.

```
# Text after # is a comment
drty = compressor      # option name
drle = 0.5             # normalized value 0..1
fi1fr := 1.2kHz        # native Micron value, here with a unit
en1atti := 250ms
lf1rafr := 4Hz
paca1le := 300         # native value: patch cable level 30.0 %
```

- `name = value`: a normalized value from 0 to 1, or an option name.
- `name := value`: a native Micron value. Envelope and portamento times also accept `ms`/`s`, and filter frequencies and LFO/S&H rates accept `Hz`/`kHz`.

Press **Execute** to send the script. The output shows the value each line actually sent, or an error.

## Presets

The preset panel writes a ready-made script for a common task. Fill in the settings and either replace the script, append to it, or **Replace & execute** in one click. For settings with a random seed, the dice button rolls a new one.

- **Init patch**: a clean single-oscillator starting point
- **Clear mod matrix** and **Mod route**: patch cable setup
- **Vibrato**, **LFO effect** (tremolo, auto-pan, filter wobble, PWM, FM wobble), **Sample & hold random**, **Looping envelope as LFO**
- **Detuned stack (supersaw)** and **Chord stack**
- **Envelope shape** (organ, pluck, keys, brass, pad, swell, ...) and **Filter envelope sweep**
- **Tracking curve**: fills the tracking generator with a curve
- **Effects**: drive and both FX slots
- **Randomize**: random values in safe ranges for chosen sections
- **Random patch**: see below

### Random patch generator

Random patch builds a complete patch from musical building blocks instead of random values. That way it doesn't produce the chaos of pure randomization. Pick a sound type, and the generator combines:

- an oscillator recipe: single, detuned pair or trio, octave stack, FM or hard sync, with randomized waveforms and wave shapes
- a filter with an envelope sweep, and an amp envelope that fits the sound type
- up to two LFO effects: vibrato, filter wobble, shape/PWM movement, auto-pan or tremolo
- drive, modulation FX and delay/reverb

The sound types are **bass**, **lead**, **pad** (soft, slow, subtle), **atmo** (wilder pads and textures), **keys**, **pluck**, **strings** and **brass**. Each type has its own envelope speeds, modulation and effect intensity, filter types and FX choices. Pads get slow attacks, chorus and reverb; bass gets fast envelopes, little modulation and some drive.

**Like most of the Micron's factory programs, every patch maps the M1 and M2 sliders** to something worth tweaking, such as filter cutoff, LFO depth, filter envelope amount or oscillator shape. The slider always moves the parameter in the direction that's audible. When M1 controls an LFO, it uses the Micron's own M1-slider influence setting. The script comments show what each slider does.

The program level is set from an estimate of the patch's loudness, so patches come out at a similar volume. **Modulation %** scales the LFO effects the sliders don't control. The same sound type and seed always give the same patch, so you can note good seeds down.

## About

The first version of the editor was written by hand. Since then it has been improved with AI assistance, and the UI styles are AI-generated as well.

## Running locally

The editor is plain HTML and JavaScript with no build step. It loads its parameter list with `fetch`, so open it through a local web server (for example `npx serve` or `python -m http.server`), not straight from the file system.
