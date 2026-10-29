/**
 * @file tests/importers.test.ts
 * @description Unit tests for RepeaterBook API filtering & `City - Callsign` formatting
 * (`src/core/repeaterBookClient.ts`), CHIRP CSV import/export & 3-mode channel merging
 * (`src/core/chirpCsvCodec.ts`), and Quick-Packs (`src/core/quickPacks.ts`).
 */

import { describe, expect, it } from 'vitest';
import {
  buildRepeaterBookApiUrl,
  cityMatchesFilter,
  clearRepeaterBookCache,
  filterAndNormalizeRepeaterBookResults,
  formatCityCallsignName,
  RepeaterBookRawEntry,
} from '../src/core/repeaterBookClient';
import {
  exportChirpCsv,
  mergeImportedChannels,
  parseChirpOrCpsCsv,
} from '../src/core/chirpCsvCodec';
import { ALL_QUICK_PACKS, NOAA_WEATHER_PACK, RECEIVE_ONLY_NOTE } from '../src/core/quickPacks';
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
      {
        // GMRS repeater pair (462.675 / 467.675 MHz) supported by radio UHF range
        'State ID': '06',
        'Rptr ID': '5',
        Frequency: '462.6750',
        'Input Freq': '467.6750',
        PL: '141.3',
        TSQ: '141.3',
        Lat: '38.50',
        Long: '-122.00',
        Callsign: 'WRGMRS',
        'Nearest City': 'Vacaville',
        State: 'CA',
        'FM Analog': 'Yes',
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

    // 3. Verifies that non-2m/70cm frequencies (e.g. GMRS or 1.2GHz) are strictly filtered out by default
    const nonAmateurResults = filterAndNormalizeRepeaterBookResults(sampleRaw, {
      region: 'us_ca',
      searchMode: 'location',
      city: 'San Francisco',
      radius: 35,
      maxResults: 10,
    });
    const gmrs = nonAmateurResults.find((c) => c.callsign === 'WRGMRS');
    expect(gmrs).toBeUndefined();

    // 3b. Verifies that GMRS and out-of-band repeaters are included when enabled in advanced bands
    const gmrsEnabledResults = filterAndNormalizeRepeaterBookResults(sampleRaw, {
      region: 'us_ca',
      searchMode: 'location',
      city: 'Vacaville',
      radius: 10,
      maxResults: 10,
      bands: {
        include2m: true,
        include70cm: true,
        includeGmrs: true,
      },
    });
    const gmrsFound = gmrsEnabledResults.find((c) => c.callsign === 'WRGMRS');
    expect(gmrsFound).toBeDefined();
    expect(gmrsFound?.band).toBe('GMRS');
    expect(gmrsFound?.formattedChannelName).toBe('Vacavil - WRGMRS');

    // 3c. Verifies selective band filtering (e.g. 70cm only, excluding 2m)
    const uhfOnlyResults = filterAndNormalizeRepeaterBookResults(sampleRaw, {
      region: 'us_ca',
      searchMode: 'proximity',
      latitude: 37.7749,
      longitude: -122.4194,
      radius: 25,
      maxResults: 10,
      bands: {
        include2m: false,
        include70cm: true,
      },
    });
    expect(uhfOnlyResults.every((c) => c.band === '70cm')).toBe(true);
    expect(uhfOnlyResults.find((c) => c.callsign === 'W6PW')).toBeUndefined();
    expect(uhfOnlyResults.find((c) => c.callsign === 'K6OAK')).toBeDefined();

    // 4. City + Radius filtering in State/Jurisdiction location mode
    const cityRadiusResults = filterAndNormalizeRepeaterBookResults(sampleRaw, {
      region: 'us_ca',
      searchMode: 'location',
      city: 'San Francisco',
      radius: 15,
      distanceUnit: 'miles',
      maxResults: 10,
    });
    expect(cityRadiusResults.length).toBeGreaterThan(0);
    expect(cityRadiusResults[0].callsign).toBe('W6PW');
    expect(cityRadiusResults[0].distanceMiles).toBeDefined();

    // 4. Native proximity query parameter builder
    const proxUrl = buildRepeaterBookApiUrl({
      region: 'us_ca',
      searchMode: 'proximity',
      latitude: 37.7749,
      longitude: -122.4194,
      radius: 35,
      distanceUnit: 'miles',
      maxResults: 50,
      apiToken: 'test_token',
    });
    expect(proxUrl).toContain('qtype=prox');
    expect(proxUrl).toContain('lat=37.7749');
    expect(proxUrl).toContain('lng=-122.4194');
    expect(proxUrl).toContain('dist=35');
    expect(proxUrl).toContain('dunit=mi');
    expect(proxUrl).not.toContain('test_token'); // tokens go in a header, never the URL

    // 5. Duplicate suppression cache can be cleared
    expect(() => clearRepeaterBookCache()).not.toThrow();
  });

  describe('insert_at never drops existing channels', () => {
    const named = (n: number, name: string) => ({
      ...createEmptyChannel(n),
      used: true,
      rxFreqHz: 146_000_000 + n * 5_000,
      txFreqHz: 146_000_000 + n * 5_000,
      name,
    });
    const incoming = [named(1, 'NEW1'), named(2, 'NEW2')];

    it('shifts channels only into the empty slots that follow', () => {
      const existing = createDefaultCodeplug().channels;
      for (const n of [...Array(10).keys()].map((i) => i + 1)) existing[n - 1] = named(n, `C${n}`);
      for (let n = 12; n <= 20; n++) existing[n - 1] = named(n, `C${n}`); // channel 11 is a gap

      const { channels, importedCount, skippedCount } = mergeImportedChannels(existing, incoming, 'insert_at', 5);
      expect([importedCount, skippedCount]).toEqual([2, 0]);
      const names = channels.slice(0, 22).map((c) => (c.used ? c.name : '-'));
      expect(names).toEqual([
        'C1', 'C2', 'C3', 'C4', 'NEW1', 'NEW2', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10',
        'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20', '-',
      ]);
      expect(channels.every((c, i) => c.channelNumber === i + 1)).toBe(true);
    });

    it('imports nothing rather than pushing channels past 500 when the list is full', () => {
      const existing = Array.from({ length: 500 }, (_, i) => named(i + 1, `C${i + 1}`));
      const { channels, importedCount, skippedCount } = mergeImportedChannels(existing, incoming, 'insert_at', 1);
      expect([importedCount, skippedCount]).toEqual([0, 2]);
      expect(channels.map((c) => c.name)).toEqual(existing.map((c) => c.name));
    });

    it('imports only as many as fit when there is less room than incoming channels', () => {
      const existing = Array.from({ length: 500 }, (_, i) => named(i + 1, `C${i + 1}`));
      existing[499] = createEmptyChannel(500);
      const { channels, importedCount, skippedCount } = mergeImportedChannels(existing, incoming, 'insert_at', 499);
      expect([importedCount, skippedCount]).toEqual([1, 1]);
      expect(channels.slice(497).map((c) => c.name)).toEqual(['C498', 'NEW1', 'C499']);
    });
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

    // Test CSV formula injection protection
    const injectionCh = createEmptyChannel(4);
    injectionCh.used = true;
    injectionCh.rxFreqHz = 146520000;
    injectionCh.txFreqHz = 146520000;
    injectionCh.name = '=cmd|calc';
    injectionCh.metadata = { notes: '+sum(A1:A10)' };
    const safeCsv = exportChirpCsv([injectionCh]);
    expect(safeCsv).toContain("\"'=cmd|calc\"");
    expect(safeCsv).toContain("\"'+sum(A1:A10)\"");

    // Verify NOAA Weather Quick-Pack has hardware NOAA flag enabled on all 7 channels
    expect(NOAA_WEATHER_PACK.channels.length).toBe(7);
    expect(NOAA_WEATHER_PACK.channels.every((c) => c.noaaFlag === true)).toBe(true);
  });
});

describe('RepeaterBook city search', () => {
  const nashvilleQuery = {
    region: 'us_ca' as const,
    searchMode: 'location' as const,
    state: '47',
    city: 'Nashville',
    radius: 25,
    distanceUnit: 'miles' as const,
    maxResults: 50,
  };

  it('ignores repeaters with a blank city when finding the city centre', () => {
    const raw: RepeaterBookRawEntry[] = [
      { Frequency: '146.94', 'Nearest City': 'Nashville', Lat: '36.16', Long: '-86.78', Callsign: 'W4A' },
      { Frequency: '147.00', 'Nearest City': '', Lat: '45.0', Long: '-120.0', Callsign: 'W7Z' },
    ];
    const res = filterAndNormalizeRepeaterBookResults(raw, nashvilleQuery);
    expect(res.map((r) => r.callsign)).toEqual(['W4A']);
    expect(res[0].distanceMiles).toBe(0);
  });

  it('matches whole city names only', () => {
    expect(cityMatchesFilter('san francisco', 'francisco')).toBe(true);
    expect(cityMatchesFilter('nashville', 'nashville tn')).toBe(true);
    expect(cityMatchesFilter('ada', 'adams')).toBe(false);
    expect(cityMatchesFilter('', 'nashville')).toBe(false);
  });
});

describe('Quick-Packs for services this radio may not transmit on', () => {
  const receiveOnlyIds = ['noaa-wx', 'us-frs', 'us-gmrs', 'marine-vhf'];

  it('carry a regulatory note and label every channel receive-only exactly once', () => {
    for (const pack of ALL_QUICK_PACKS) {
      const expectNote = receiveOnlyIds.includes(pack.id);
      expect(Boolean(pack.regulatoryNote)).toBe(expectNote);
      for (const ch of pack.channels) {
        const notes = ch.metadata?.notes ?? '';
        expect(notes.startsWith(RECEIVE_ONLY_NOTE)).toBe(expectNote);
        expect(notes.indexOf(RECEIVE_ONLY_NOTE, 1)).toBe(-1);
        expect(ch.name.length).toBeLessThanOrEqual(16);
      }
    }
  });

  it('sets GMRS channels 1–14 to Low power', () => {
    const gmrs = ALL_QUICK_PACKS.find((p) => p.id === 'us-gmrs')!;
    expect(gmrs.channels.slice(0, 14).every((c) => c.power === 'Low')).toBe(true);
    expect(gmrs.channels.slice(14, 22).every((c) => c.power === 'High')).toBe(true);
  });
});

describe('CHIRP CSV edge cases', () => {
  it('ranks watt values against the file instead of guessing from the first digit', () => {
    const csv = [
      'Location,Name,Frequency,Duplex,Offset,Tone,Mode,Power',
      '1,FIVE,146.520000,,0,,FM,5.0W',
      '2,TWENTYFIVE,146.550000,,0,,FM,25W',
      '3,FIFTY,146.580000,,0,,FM,50W',
      '4,WORD,146.430000,,0,,FM,Low',
    ].join('\n');
    expect(parseChirpOrCpsCsv(csv).map((c) => `${c.name}:${c.power}`)).toEqual([
      'FIVE:Low',
      'TWENTYFIVE:Middle',
      'FIFTY:High',
      'WORD:Low',
    ]);
  });

  it('keeps a quoted comment with a line break in one row', () => {
    const csv = 'Location,Name,Frequency,Comment\n1,LINK,146.940000,"Linked to\nW4ABC"\n2,NEXT,147.000000,plain';
    const rows = parseChirpOrCpsCsv(csv);
    expect(rows.map((r) => r.name)).toEqual(['LINK', 'NEXT']);
    expect(rows[0].metadata?.notes).toBe('Linked to\nW4ABC');
  });

  it('exports cross-band pairs as split with the absolute TX frequency', () => {
    const ch = { ...createEmptyChannel(1), used: true, name: 'XBAND', rxFreqHz: 146_520_000, txFreqHz: 446_000_000 };
    const row = exportChirpCsv([ch]).split('\n')[1].split(',');
    expect(row.slice(3, 5)).toEqual(['split', '446.000000']);

    const rpt = { ...createEmptyChannel(2), used: true, name: 'RPT', rxFreqHz: 444_500_000, txFreqHz: 449_500_000 };
    expect(exportChirpCsv([rpt]).split('\n')[1].split(',').slice(3, 5)).toEqual(['+', '5.000000']);

    // Round trip through the importer
    expect(parseChirpOrCpsCsv(exportChirpCsv([ch]))[0].txFreqHz).toBe(446_000_000);
  });
});

describe('insert_at renumbering', () => {
  it('reports which existing channels moved', () => {
    const existing = createDefaultCodeplug().channels;
    for (const n of [1, 2, 3]) Object.assign(existing[n - 1], { used: true, rxFreqHz: 146_000_000 + n, txFreqHz: 146_000_000 + n, name: `C${n}` });
    const incoming = parseChirpOrCpsCsv('Name,Frequency\nNEW,146.52');
    const { renumbering } = mergeImportedChannels(existing, incoming, 'insert_at', 2);
    expect([...renumbering]).toEqual([[2, 3], [3, 4]]);
  });
});
