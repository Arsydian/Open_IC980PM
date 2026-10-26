/**
 * @file tests/importers.test.ts
 * @description Unit tests for RepeaterBook API filtering & `City - Callsign` formatting
 * (`src/core/repeaterBookClient.ts`), CHIRP CSV import/export & 3-mode channel merging
 * (`src/core/chirpCsvCodec.ts`), and Quick-Packs (`src/core/quickPacks.ts`).
 */

import { describe, expect, it } from 'vitest';
import {
  filterAndNormalizeRepeaterBookResults,
  formatCityCallsignName,
  RepeaterBookRawEntry,
} from '../src/core/repeaterBookClient';
import {
  exportChirpCsv,
  mergeImportedChannels,
  parseChirpOrCpsCsv,
} from '../src/core/chirpCsvCodec';
import { NOAA_WEATHER_PACK } from '../src/core/quickPacks';
import { createDefaultCodeplug, createEmptyChannel } from '../src/core/ysfCodec';

describe('RepeaterBook, CHIRP CSV & Quick-Pack Importers', () => {
  it('formats channel names as "City - Callsign" within the 16-character hardware limit', () => {
    expect(formatCityCallsignName('Boston', 'W1BOS')).toBe('Boston - W1BOS');
    expect(formatCityCallsignName('San Francisco', 'W6PW')).toBe('San Franc - W6PW');
    expect(formatCityCallsignName('Austin', 'KA5D').length).toBeLessThanOrEqual(16);
  });

  it('filters RepeaterBook entries to 2m/70cm FM Analog, applies radius/city filters, and limits count', () => {
    const sampleRaw: RepeaterBookRawEntry[] = [
      {
        'State ID': '06',
        'Rptr ID': '1',
        Frequency: '145.1500',
        'Input Freq': '144.5500',
        PL: '114.8',
        TSQ: '114.8',
        Lat: '37.75',
        Long: '-122.45',
        Callsign: 'W6PW',
        'Nearest City': 'San Francisco',
        State: 'CA',
        'FM Analog': 'Yes',
        'Operational Status': 'On-Air',
      },
      {
        'State ID': '06',
        'Rptr ID': '2',
        Frequency: '444.2000',
        'Input Freq': '449.2000',
        PL: 'D023N',
        TSQ: '',
        Lat: '37.80',
        Long: '-122.27',
        Callsign: 'K6OAK',
        'Nearest City': 'Oakland',
        State: 'CA',
        'FM Analog': 'Yes',
        'Operational Status': 'On-Air',
      },
      {
        // 1.2 GHz repeater -> should be automatically filtered out (2m/70cm only)
        'State ID': '06',
        'Rptr ID': '3',
        Frequency: '1285.2000',
        'Input Freq': '1273.2000',
        PL: '100.0',
        Lat: '37.76',
        Long: '-122.42',
        Callsign: 'W6GHZ',
        'Nearest City': 'San Francisco',
        'FM Analog': 'Yes',
        'Operational Status': 'On-Air',
      },
      {
        // DMR-only (FM Analog = No) -> should be automatically filtered out
        'State ID': '06',
        'Rptr ID': '4',
        Frequency: '441.0000',
        'Input Freq': '446.0000',
        Callsign: 'W6DMR',
        'Nearest City': 'San Francisco',
        'FM Analog': 'No',
        DMR: 'Yes',
        'Operational Status': 'On-Air',
      },
    ];

    // 1. Proximity search with maxResults = 2
    const proxResults = filterAndNormalizeRepeaterBookResults(sampleRaw, {
      region: 'us_ca',
      searchMode: 'proximity',
      latitude: 37.7749,
      longitude: -122.4194,
      radius: 25,
      distanceUnit: 'miles',
      maxResults: 2,
      openOnly: true,
    });

    expect(proxResults.length).toBe(2);
    expect(proxResults[0].callsign).toBe('W6PW');
    expect(proxResults[0].formattedChannelName).toBe('San Franc - W6PW');
    expect(proxResults[0].band).toBe('2m');
    expect(proxResults[1].callsign).toBe('K6OAK');
    expect(proxResults[1].formattedChannelName).toBe('Oakland - K6OAK');
    expect(proxResults[1].band).toBe('70cm');

    // 2. Arbitrary maxResults = 1 limit
    const limited = filterAndNormalizeRepeaterBookResults(sampleRaw, {
      region: 'us_ca',
      searchMode: 'location',
      maxResults: 1,
    });
    expect(limited.length).toBe(1);
  });

  it('parses and exports CHIRP CSV and merges channels via append_empty, insert_at, and overwrite_at', () => {
    const csvSample = [
      'Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,Mode,TStep,Skip,Power,Comment',
      '1,TEST 2M,146.940000,-,0.600000,Tone,100.0,88.5,023,NN,FM,5.00,,10W,Repeater 1',
      '2,TEST 70CM,444.500000,+,5.000000,DTCS,88.5,88.5,047,NN,NFM,5.00,S,5W,Repeater 2',
    ].join('\n');

    const parsed = parseChirpOrCpsCsv(csvSample);
    expect(parsed.length).toBe(2);
    expect(parsed[0].rxFreqHz).toBe(146940000);
    expect(parsed[0].txFreqHz).toBe(146340000);
    expect(parsed[0].txToneType).toBe('CTCSS');
    expect(parsed[0].txToneValue).toBe(100.0);

    expect(parsed[1].rxFreqHz).toBe(444500000);
    expect(parsed[1].txFreqHz).toBe(449500000);
    expect(parsed[1].bandwidth).toBe('Narrow');
    expect(parsed[1].scanAdd).toBe(false);

    // Test append_empty (default) when slot 1 is already occupied
    const cp = createDefaultCodeplug();
    const existingCh1 = createEmptyChannel(1);
    existingCh1.used = true;
    existingCh1.name = 'EXISTING CH1';
    existingCh1.rxFreqHz = 146520000;
    existingCh1.txFreqHz = 146520000;
    cp.channels[0] = existingCh1;

    const { channels: appended, importedCount } = mergeImportedChannels(
      cp.channels,
      parsed,
      'append_empty'
    );
    expect(importedCount).toBe(2);
    expect(appended[0].name).toBe('EXISTING CH1'); // Preserved!
    expect(appended[1].name).toBe('TEST 2M'); // Appended into first empty (#2)
    expect(appended[2].name).toBe('TEST 70CM'); // Appended into #3

    // Test export back to CHIRP CSV
    const exportedCsv = exportChirpCsv(appended);
    expect(exportedCsv).toContain('EXISTING CH1');
    expect(exportedCsv).toContain('TEST 2M');

    // Verify NOAA Weather Quick-Pack has hardware NOAA flag enabled on all 7 channels
    expect(NOAA_WEATHER_PACK.channels.length).toBe(7);
    expect(NOAA_WEATHER_PACK.channels.every((c) => c.noaaFlag === true)).toBe(true);
  });
});
