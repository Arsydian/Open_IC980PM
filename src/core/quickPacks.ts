/**
 * @file src/core/quickPacks.ts
 * @description Built-in curated frequency presets ("Quick-Packs") for one-click import:
 * - NOAA Weather Radio (`WX 1–7` `162.400–162.550 MHz` with hardware NOAA bit `Byte 59 bit 4 = 0x10` enabled)
 * - US FRS (`Ch 1–22`)
 * - US GMRS (`Ch 1–22 + 8 Repeater Pairs`)
 * - VHF Marine Calling & Intership Channels
 * - 2m / 70cm Amateur Radio National FM Simplex Calling Channels
 */

import type { Bandwidth, ChannelRecord, TxPower } from '../types/radio';
import { createEmptyChannel } from './ysfCodec';

export interface QuickPackDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  /**
   * Shown before import for services this amateur radio may not lawfully transmit on (US rules).
   * The radio has no confirmed per-channel TX-inhibit setting, so the channels can still transmit.
   */
  regulatoryNote?: string;
  channels: ChannelRecord[];
}

/** Prefix added to the notes of channels from packs with a `regulatoryNote`. */
export const RECEIVE_ONLY_NOTE = 'RECEIVE ONLY: do not transmit on this channel with this radio.';

/** Adds `RECEIVE_ONLY_NOTE` to every channel of a pack that must not be used to transmit. */
function receiveOnly(channels: ChannelRecord[]): ChannelRecord[] {
  return channels.map((ch) => {
    const notes = ch.metadata?.notes;
    if (notes?.startsWith(RECEIVE_ONLY_NOTE)) return ch;
    return {
      ...ch,
      metadata: { ...ch.metadata, source: 'quickpack', notes: notes ? `${RECEIVE_ONLY_NOTE} ${notes}` : RECEIVE_ONLY_NOTE },
    };
  });
}

function makePackChannel(
  name: string,
  rxMhz: number,
  txMhz: number = rxMhz,
  power: TxPower = 'High',
  bandwidth: Bandwidth = 'Wide',
  noaaFlag: boolean = false,
  notes?: string
): ChannelRecord {
  const ch = createEmptyChannel(1);
  ch.used = true;
  ch.name = name.slice(0, 16);
  ch.rxFreqHz = Math.round(rxMhz * 1_000_000);
  ch.txFreqHz = Math.round(txMhz * 1_000_000);
  ch.power = power;
  ch.bandwidth = bandwidth;
  ch.modulation = 'FM';
  ch.noaaFlag = noaaFlag;
  ch.scanAdd = !noaaFlag; // Typically exclude continuous weather broadcasts from normal scan unless desired
  ch.metadata = {
    source: 'quickpack',
    notes,
  };
  return ch;
}

/**
 * NOAA Weather Radio All Hazards Channels (`WX 1..7`) with the hardware NOAA bit (`Byte 59 Bit 4`) enabled.
 */
export const NOAA_WEATHER_PACK: QuickPackDefinition = {
  id: 'noaa-wx',
  name: 'NOAA Weather (WX 1–7)',
  category: 'Weather & Emergency',
  description: 'All 7 NOAA Weather Radio frequencies (162.400–162.550 MHz) with the IC-980 Pro Max hardware NOAA flag enabled.',
  regulatoryNote:
    'Receive only. NOAA Weather Radio is a broadcast service; never transmit on these frequencies.',
  channels: receiveOnly([
    makePackChannel('NOAA WX 1', 162.55, 162.55, 'Low', 'Wide', true, 'NOAA Weather Channel 1 (162.550 MHz)'),
    makePackChannel('NOAA WX 2', 162.4, 162.4, 'Low', 'Wide', true, 'NOAA Weather Channel 2 (162.400 MHz)'),
    makePackChannel('NOAA WX 3', 162.475, 162.475, 'Low', 'Wide', true, 'NOAA Weather Channel 3 (162.475 MHz)'),
    makePackChannel('NOAA WX 4', 162.425, 162.425, 'Low', 'Wide', true, 'NOAA Weather Channel 4 (162.425 MHz)'),
    makePackChannel('NOAA WX 5', 162.45, 162.45, 'Low', 'Wide', true, 'NOAA Weather Channel 5 (162.450 MHz)'),
    makePackChannel('NOAA WX 6', 162.5, 162.5, 'Low', 'Wide', true, 'NOAA Weather Channel 6 (162.500 MHz)'),
    makePackChannel('NOAA WX 7', 162.525, 162.525, 'Low', 'Wide', true, 'NOAA Weather Channel 7 (162.525 MHz)'),
  ]),
};

/**
 * 2m & 70cm Amateur Radio National FM Simplex Calling & EmComm Frequencies.
 */
export const HAM_CALLING_PACK: QuickPackDefinition = {
  id: 'ham-calling',
  name: '2m / 70cm Ham Simplex Calling',
  category: 'Amateur Radio',
  description: 'National 2m (146.520 MHz) and 70cm (446.000 MHz) FM simplex calling and tactical channels.',
  channels: [
    makePackChannel('2M CALL 146.52', 146.52, 146.52, 'High', 'Wide', false, 'National 2m FM Simplex Calling'),
    makePackChannel('2M SIMP 146.55', 146.55, 146.55, 'High', 'Wide', false, '2m FM Simplex'),
    makePackChannel('2M SIMP 146.58', 146.58, 146.58, 'High', 'Wide', false, '2m FM Simplex'),
    makePackChannel('2M SIMP 147.42', 147.42, 147.42, 'High', 'Wide', false, '2m FM Simplex'),
    makePackChannel('2M SIMP 147.54', 147.54, 147.54, 'High', 'Wide', false, '2m FM Simplex'),
    makePackChannel('70CM CALL 446.0', 446.0, 446.0, 'High', 'Wide', false, 'National 70cm FM Simplex Calling'),
    makePackChannel('70CM SIMP 446.05', 446.05, 446.05, 'High', 'Wide', false, '70cm FM Simplex'),
  ],
};

/**
 * US FRS Channels 1–22 (Narrowband FM).
 */
export const FRS_PACK: QuickPackDefinition = {
  id: 'us-frs',
  name: 'FRS Channels (1–22)',
  category: 'Personal Radio (US)',
  description: 'Standard 22 Family Radio Service (FRS) UHF channels (462 / 467 MHz, Narrowband).',
  regulatoryNote:
    'Receive only. In the US, FRS may only be transmitted on with FCC-certified FRS radios, which the IC-980 Pro Max is not.',
  channels: receiveOnly([
    makePackChannel('FRS CH 01', 462.5625, 462.5625, 'Low', 'Narrow'),
    makePackChannel('FRS CH 02', 462.5875, 462.5875, 'Low', 'Narrow'),
    makePackChannel('FRS CH 03', 462.6125, 462.6125, 'Low', 'Narrow'),
    makePackChannel('FRS CH 04', 462.6375, 462.6375, 'Low', 'Narrow'),
    makePackChannel('FRS CH 05', 462.6625, 462.6625, 'Low', 'Narrow'),
    makePackChannel('FRS CH 06', 462.6875, 462.6875, 'Low', 'Narrow'),
    makePackChannel('FRS CH 07', 462.7125, 462.7125, 'Low', 'Narrow'),
    makePackChannel('FRS CH 08', 467.5625, 467.5625, 'Low', 'Narrow'),
    makePackChannel('FRS CH 09', 467.5875, 467.5875, 'Low', 'Narrow'),
    makePackChannel('FRS CH 10', 467.6125, 467.6125, 'Low', 'Narrow'),
    makePackChannel('FRS CH 11', 467.6375, 467.6375, 'Low', 'Narrow'),
    makePackChannel('FRS CH 12', 467.6625, 467.6625, 'Low', 'Narrow'),
    makePackChannel('FRS CH 13', 467.6875, 467.6875, 'Low', 'Narrow'),
    makePackChannel('FRS CH 14', 467.7125, 467.7125, 'Low', 'Narrow'),
    makePackChannel('FRS CH 15', 462.55, 462.55, 'Low', 'Narrow'),
    makePackChannel('FRS CH 16', 462.575, 462.575, 'Low', 'Narrow'),
    makePackChannel('FRS CH 17', 462.6, 462.6, 'Low', 'Narrow'),
    makePackChannel('FRS CH 18', 462.625, 462.625, 'Low', 'Narrow'),
    makePackChannel('FRS CH 19', 462.65, 462.65, 'Low', 'Narrow'),
    makePackChannel('FRS CH 20', 462.675, 462.675, 'Low', 'Narrow'),
    makePackChannel('FRS CH 21', 462.7, 462.7, 'Low', 'Narrow'),
    makePackChannel('FRS CH 22', 462.725, 462.725, 'Low', 'Narrow'),
  ]),
};

/**
 * US GMRS Channels (1–22 + 8 Repeater Pairs with +5.000 MHz offset).
 */
export const GMRS_PACK: QuickPackDefinition = {
  id: 'us-gmrs',
  name: 'GMRS (Ch 1–22 + 8 Repeaters)',
  category: 'Personal Radio (US)',
  description: 'All 22 GMRS simplex channels plus the 8 GMRS repeater pairs (462.550–462.725 MHz with +5 MHz input).',
  regulatoryNote:
    'Receive only unless permitted. In the US, GMRS transmitting needs a GMRS licence and a Part 95E-certified radio; the IC-980 Pro Max is an amateur radio. Channels 1–7 are set to Low because GMRS limits them to 5 W ERP.',
  channels: receiveOnly([
    ...FRS_PACK.channels.map((ch, idx) => ({
      ...ch,
      name: ch.name.replace('FRS', 'GMRS'),
      // Channels 1–7 (5 W ERP) and 8–14 (0.5 W ERP, narrow) get Low; 15–22 High
      power: (idx <= 13 ? 'Low' : 'High') as TxPower,
      bandwidth: (idx >= 7 && idx <= 13 ? 'Narrow' : 'Wide') as Bandwidth,
    })),
    makePackChannel('GMRS RPT 15', 462.55, 467.55, 'High', 'Wide', false, 'GMRS Repeater 550 (+5 MHz)'),
    makePackChannel('GMRS RPT 16', 462.575, 467.575, 'High', 'Wide', false, 'GMRS Repeater 575 (+5 MHz)'),
    makePackChannel('GMRS RPT 17', 462.6, 467.6, 'High', 'Wide', false, 'GMRS Repeater 600 (+5 MHz)'),
    makePackChannel('GMRS RPT 18', 462.625, 467.625, 'High', 'Wide', false, 'GMRS Repeater 625 (+5 MHz)'),
    makePackChannel('GMRS RPT 19', 462.65, 467.65, 'High', 'Wide', false, 'GMRS Repeater 650 (+5 MHz)'),
    makePackChannel('GMRS RPT 20', 462.675, 467.675, 'High', 'Wide', false, 'GMRS Repeater 675 (+5 MHz)'),
    makePackChannel('GMRS RPT 21', 462.7, 467.7, 'High', 'Wide', false, 'GMRS Repeater 700 (+5 MHz)'),
    makePackChannel('GMRS RPT 22', 462.725, 467.725, 'High', 'Wide', false, 'GMRS Repeater 725 (+5 MHz)'),
  ]),
};

/**
 * VHF Marine Calling, Distress & Recreational Channels.
 */
export const MARINE_VHF_PACK: QuickPackDefinition = {
  id: 'marine-vhf',
  name: 'VHF Marine (Ch 06–72)',
  category: 'Maritime',
  description: 'Key VHF Marine distress, hailing, bridge-to-bridge, and non-commercial boat channels.',
  regulatoryNote:
    'Receive only. Transmitting on VHF marine channels needs a marine type-accepted radio (and in many countries a licence), which the IC-980 Pro Max is not.',
  channels: receiveOnly([
    makePackChannel('MARINE 16 DISTR', 156.8, 156.8, 'High', 'Wide', false, 'Distress, Safety & Calling'),
    makePackChannel('MARINE 09 CALL', 156.45, 156.45, 'High', 'Wide', false, 'Boater Calling Channel'),
    makePackChannel('MARINE 06 SAFE', 156.3, 156.3, 'Low', 'Wide', false, 'Intership Safety'),
    makePackChannel('MARINE 13 BRDG', 156.65, 156.65, 'Low', 'Wide', false, 'Navigational Bridge-to-Bridge'),
    makePackChannel('MARINE 22A USCG', 157.1, 157.1, 'High', 'Wide', false, 'US Coast Guard Liaison'),
    makePackChannel('MARINE 68 BOAT', 156.425, 156.425, 'Low', 'Wide', false, 'Non-Commercial Recreational'),
    makePackChannel('MARINE 69 BOAT', 156.475, 156.475, 'Low', 'Wide', false, 'Non-Commercial Recreational'),
    makePackChannel('MARINE 71 BOAT', 156.575, 156.575, 'Low', 'Wide', false, 'Non-Commercial Recreational'),
    makePackChannel('MARINE 72 BOAT', 156.625, 156.625, 'Low', 'Wide', false, 'Non-Commercial Intership'),
  ]),
};

export const ALL_QUICK_PACKS: readonly QuickPackDefinition[] = [
  NOAA_WEATHER_PACK,
  HAM_CALLING_PACK,
  GMRS_PACK,
  FRS_PACK,
  MARINE_VHF_PACK,
];
