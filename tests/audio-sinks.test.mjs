import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	classifySink,
	formatSpeakerReport,
	parseWpctlStatus,
	pickSpeakerSink
} from '../src/lib/server/audioSinks.js';

const WPCTL_ANALOG_AND_DUMMY = `
Audio
 ├─ Devices:
 │      40. Built-in Audio                      [alsa]
 │     112. Dummy Output                        [alsa]
 │
 ├─ Sinks:
 │  *   54. Dummy Output                        [vol: 1.00]
 │      41. Built-in Audio Analog Stereo        [vol: 0.40]
 │      62. HDMI / DisplayPort 3 Output         [vol: 1.00]
 │
 ├─ Sources:
 │      42. Built-in Audio Analog Stereo        [vol: 1.00]
 │
 └─ Streams:

Video
 ├─ Devices:
 │
 ├─ Sinks:
 │      99. Should Not Parse                    [vol: 1.00]
`;

const WPCTL_HDMI_ONLY = `
Audio
 ├─ Sinks:
 │  *   62. HDMI / DisplayPort Output           [vol: 1.00]
`;

const WPCTL_USB_HEADPHONE = `
Audio
 ├─ Sinks:
 │      41. HDMI / DisplayPort                  [vol: 1.00]
 │  *   70. USB Audio Analog Stereo             [vol: 0.80]
 │      71. Built-in Audio Headphones           [vol: 0.50]
`;

const WPCTL_DUMMY_ONLY = `
Audio
 ├─ Sinks:
 │  *   54. Dummy Output                        [vol: 1.00]
`;

test('parseWpctlStatus reads default marker and ignores Video sinks', () => {
	const sinks = parseWpctlStatus(WPCTL_ANALOG_AND_DUMMY);
	assert.deepEqual(
		sinks.map((s) => ({ id: s.id, name: s.name, default: s.default })),
		[
			{ id: 54, name: 'Dummy Output', default: true },
			{ id: 41, name: 'Built-in Audio Analog Stereo', default: false },
			{ id: 62, name: 'HDMI / DisplayPort 3 Output', default: false }
		]
	);
});

test('pickSpeakerSink prefers analog over Dummy and HDMI', () => {
	const pick = pickSpeakerSink(parseWpctlStatus(WPCTL_ANALOG_AND_DUMMY));
	assert.equal(pick.id, 41);
	assert.equal(classifySink(pick.name), 'analog');
	assert.match(formatSpeakerReport(pick).summary, /Analog Stereo/);
});

test('pickSpeakerSink prefers headphones over USB over HDMI', () => {
	const pick = pickSpeakerSink(parseWpctlStatus(WPCTL_USB_HEADPHONE));
	assert.equal(pick.name, 'Built-in Audio Headphones');
	assert.equal(classifySink(pick.name), 'headphone');
});

test('pickSpeakerSink falls back to HDMI when that is the only real sink', () => {
	const pick = pickSpeakerSink(parseWpctlStatus(WPCTL_HDMI_ONLY));
	assert.equal(classifySink(pick.name), 'hdmi');
	assert.equal(formatSpeakerReport(pick).ok, true);
});

test('pickSpeakerSink returns null when only Dummy Output exists', () => {
	const sinks = parseWpctlStatus(WPCTL_DUMMY_ONLY);
	assert.equal(pickSpeakerSink(sinks), null);
	assert.equal(formatSpeakerReport(null, sinks).ok, false);
});
