import { describe, expect, it } from 'vitest';
import { importWorkout, parseMrc, parseZwo } from '../src/sim/workoutImport';
import { expandBlocks, totalDuration } from '../src/sim/workout';

const lengthOf = (blocks: Parameters<typeof expandBlocks>[0]) => totalDuration(expandBlocks(blocks));

const ZWO = `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>Quelqu'un</author>
  <name>Sweet spot &amp; fin de séance</name>
  <description>Test</description>
  <sportType>bike</sportType>
  <tags/>
  <workout>
    <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
    <SteadyState Duration="300" Power="0.6">
      <textevent timeoffset="10" message="Allez"/>
    </SteadyState>
    <IntervalsT Repeat="3" OnDuration="600" OffDuration="300" OnPower="0.9" OffPower="0.55"/>
    <Ramp Duration="240" PowerLow="0.6" PowerHigh="1.1"/>
    <FreeRide Duration="120" FlatRoad="1"/>
    <Cooldown Duration="300" PowerLow="0.7" PowerHigh="0.4"/>
  </workout>
</workout_file>`;

describe('import d’une séance .zwo', () => {
  const { workout, notes } = parseZwo(ZWO, 'fichier');

  it('lit le nom, avec ses caractères spéciaux', () => {
    expect(workout.name).toBe('Sweet spot & fin de séance');
  });
  it('convertit chaque type de bloc', () => {
    expect(workout.blocks.map((b) => b.kind)).toEqual(['echauffement', 'stable', 'intervalles', 'rampe', 'stable', 'recuperation']);
  });
  it('convertit les fractions de FTP en pourcents', () => {
    const [warmup, steady, intervals, ramp, , cooldown] = workout.blocks;
    expect([warmup.fromPct, warmup.toPct]).toEqual([45, 75]);
    expect([steady.fromPct, steady.toPct]).toEqual([60, 60]);
    expect([ramp.fromPct, ramp.toPct]).toEqual([60, 110]);
    expect([cooldown.fromPct, cooldown.toPct]).toEqual([70, 40]);
    expect(intervals).toMatchObject({ repeat: 3, durationS: 600, restS: 300, fromPct: 90, toPct: 55 });
  });
  it('garde la durée exacte de la séance', () => {
    // 600 + 300 + 3 × (600 + 300) + 240 + 120 + 300
    expect(lengthOf(workout.blocks)).toBe(4260);
  });
  it('signale ce qui n’a pas d’équivalent', () => {
    expect(notes.join(' ')).toMatch(/libre/);
  });
  it('donne à chaque import un identifiant propre', () => {
    expect(parseZwo(ZWO, 'a').workout.id).not.toBe(parseZwo(ZWO, 'a').workout.id);
  });
  it('prend le nom du fichier s’il n’y en a pas dans la séance', () => {
    const bare = '<workout_file><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>';
    expect(parseZwo(bare, 'Mon fichier').workout.name).toBe('Mon fichier');
  });
  it('accepte des puissances déjà en pourcents et des guillemets simples', () => {
    const odd = "<workout_file><workout><SteadyState Duration='120' Power='85'/></workout></workout_file>";
    expect(parseZwo(odd, 'x').workout.blocks[0].fromPct).toBe(85);
  });
  it('borne les valeurs absurdes', () => {
    const wild = '<workout_file><workout><SteadyState Duration="999999" Power="3.5"/></workout></workout_file>';
    const b = parseZwo(wild, 'x').workout.blocks[0];
    expect(b.durationS).toBe(10800);
    expect(b.fromPct).toBe(200);
  });
  it('refuse un fichier sans séance', () => {
    expect(() => parseZwo('<workout_file><name>vide</name></workout_file>', 'x')).toThrow(/aucun bloc/i);
    expect(() => parseZwo('<workout_file><workout></workout></workout_file>', 'x')).toThrow(/aucun bloc/i);
  });
});

const MRC = `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = Pyramide
FILE NAME = pyramide.mrc
MINUTES PERCENT
[END COURSE HEADER]
[COURSE DATA]
0.00 50
5.00 50
5.00 75
7.50 75
10.00 75
10.00 90
20.00 90
20.00 50
25.00 50
30.00 80
[END COURSE DATA]
`;

describe('import d’une séance .mrc et .erg', () => {
  it('lit les paliers, les rampes et fusionne les points d’un même palier', () => {
    const { workout } = parseMrc(MRC, 'pyramide.mrc', 220);
    expect(workout.name).toBe('Pyramide');
    expect(workout.blocks.map((b) => [b.kind, b.durationS, b.fromPct, b.toPct])).toEqual([
      ['stable', 300, 50, 50],
      ['stable', 300, 75, 75],
      ['stable', 600, 90, 90],
      ['stable', 300, 50, 50],
      ['rampe', 300, 50, 80],
    ]);
    expect(lengthOf(workout.blocks)).toBe(1800);
  });
  it('convertit les watts d’un .erg avec la FTP du fichier', () => {
    const erg = `[COURSE HEADER]\nFTP = 250\nMINUTES WATTS\n[END COURSE HEADER]\n[COURSE DATA]\n0 125\n10 125\n10 250\n20 250\n[END COURSE DATA]`;
    const { workout, notes } = parseMrc(erg, 'x.erg', 180);
    expect(workout.blocks.map((b) => b.fromPct)).toEqual([50, 100]);
    expect(notes).toEqual([]);
  });
  it('utilise la FTP du joueur si le fichier n’en donne pas, et le dit', () => {
    const erg = `[COURSE HEADER]\nMINUTES WATTS\n[END COURSE HEADER]\n[COURSE DATA]\n0 110\n5 110\n[END COURSE DATA]`;
    const { workout, notes } = parseMrc(erg, 'x.erg', 220);
    expect(workout.blocks[0].fromPct).toBe(50);
    expect(notes[0]).toMatch(/220 W/);
  });
  it('prend le nom du fichier sans description', () => {
    const bare = `[COURSE HEADER]\nMINUTES PERCENT\n[END COURSE HEADER]\n[COURSE DATA]\n0 60\n5 60\n[END COURSE DATA]`;
    expect(parseMrc(bare, 'C:\\dossier\\Endurance facile.mrc', 220).workout.name).toBe('Endurance facile');
  });
  it('accepte la virgule décimale', () => {
    const fr = `[COURSE HEADER]\nMINUTES PERCENT\n[END COURSE HEADER]\n[COURSE DATA]\n0,0 60\n2,5 60\n[END COURSE DATA]`;
    expect(lengthOf(parseMrc(fr, 'x.mrc', 220).workout.blocks)).toBe(150);
  });
  it('refuse un fichier sans données', () => {
    expect(() => parseMrc('rien du tout', 'x.mrc', 220)).toThrow(/aucune donnée/i);
    expect(() => parseMrc('[COURSE DATA]\n0 50\n[END COURSE DATA]', 'x.mrc', 220)).toThrow(/trop peu/i);
  });
});

describe('import d’un fichier quelconque', () => {
  it('reconnaît le format par l’extension ou par le contenu', () => {
    expect(importWorkout('seance.zwo', ZWO, 220).workout.blocks.length).toBe(6);
    expect(importWorkout('seance.xml', ZWO, 220).workout.blocks.length).toBe(6);
    expect(importWorkout('seance.mrc', MRC, 220).workout.blocks.length).toBe(5);
    expect(importWorkout('seance.txt', MRC, 220).workout.blocks.length).toBe(5);
  });
  it('refuse un format inconnu avec un message clair', () => {
    expect(() => importWorkout('photo.png', 'PNG...', 220)).toThrow(/\.zwo, \.mrc ou \.erg/);
  });
  it('refuse un fichier trop gros', () => {
    expect(() => importWorkout('gros.zwo', 'x'.repeat(1_000_001), 220)).toThrow(/trop gros/);
  });
});
