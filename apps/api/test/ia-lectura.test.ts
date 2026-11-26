import { describe, expect, it } from 'vitest';
import { parseAdviceList } from '../src/modules/advice/ai-parse.js';

const it1 = { kind: 'saving', severity: 'tip', title: 'Recorta las suscripciones', body: 'Pagas 34 € al mes en servicios que casi no usas.', impactMinor: 3400 };
const it2 = { kind: 'win', severity: 'win', title: 'Buen mes de ahorro', body: 'Has ahorrado el 18 % de lo que ingresas este mes.' };

describe('lectura tolerante de la respuesta de la IA', () => {
  it('JSON limpio', () => {
    const r = parseAdviceList(JSON.stringify([it1, it2]), false)!;
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ kind: 'saving', title: 'Recorta las suscripciones', impactMinor: 3400 });
  });

  it('con valla ```json y texto alrededor', () => {
    const txt = `Aquí tienes tus consejos:\n\n\`\`\`json\n${JSON.stringify([it1, it2], null, 2)}\n\`\`\`\n\nEspero que te sirvan.`;
    expect(parseAdviceList(txt, false)).toHaveLength(2);
  });

  it('texto con corchetes antes de la lista', () => {
    const txt = `Nota [importante]: respondo en JSON.\n${JSON.stringify([it1])}`;
    expect(parseAdviceList(txt, false)).toHaveLength(1);
  });

  it('objeto envolvente {"consejos":[…]} o {"items":[…]}', () => {
    expect(parseAdviceList(JSON.stringify({ consejos: [it1, it2] }), false)).toHaveLength(2);
    expect(parseAdviceList(`Resultado: ${JSON.stringify({ items: [it1] })}`, false)).toHaveLength(1);
  });

  it('respuesta cortada a mitad: rescata los consejos completos', () => {
    const entero = JSON.stringify([it1, it2, { ...it1, title: 'Tercero cortado' }]);
    const cortado = entero.slice(0, entero.lastIndexOf('"title"') + 12);
    const r = parseAdviceList(cortado, false)!;
    expect(r).toHaveLength(2);
  });

  it('valores fuera de lo pedido: se corrigen (kind/severity en español, importe como texto)', () => {
    const r = parseAdviceList(JSON.stringify([{ kind: 'Ahorro', severity: 'Atención', title: 'Revisa el seguro', body: 'Tu seguro cuesta más que la media del mercado.', impactMinor: '2500' }]), false)!;
    expect(r[0]).toMatchObject({ kind: 'saving', severity: 'warn', impactMinor: 2500 });
    const raro = parseAdviceList(JSON.stringify([{ kind: 'otra', severity: 'rara', title: 'Un título', body: 'Un cuerpo suficientemente largo.', impactMinor: -5 }]), false)!;
    expect(raro[0]).toMatchObject({ kind: 'saving', severity: 'tip' });
    expect(raro[0]!.impactMinor).toBeUndefined();
  });

  it('acepta nombres de campo en español', () => {
    const r = parseAdviceList(JSON.stringify([{ tipo: 'gasto', titulo: 'Menos comida a domicilio', cuerpo: 'Gastas 120 € al mes en repartos a domicilio.', accion: 'Pon un tope de 60 € al mes.' }]), true)!;
    expect(r[0]).toMatchObject({ kind: 'spending', title: 'Menos comida a domicilio', action: 'Pon un tope de 60 € al mes.' });
  });

  it('descarta solo los consejos rotos, no toda la respuesta', () => {
    const r = parseAdviceList(JSON.stringify([it1, { title: 'x' }, 'texto suelto', null, it2]), false)!;
    expect(r).toHaveLength(2);
  });

  it('recorta textos largos y limita el número de consejos', () => {
    const largo = { ...it1, title: 'T'.repeat(200), body: 'B'.repeat(900) };
    const r = parseAdviceList(JSON.stringify(Array.from({ length: 15 }, () => largo)), false)!;
    expect(r).toHaveLength(8);
    expect(r[0]!.title.length).toBeLessThanOrEqual(90);
    expect(r[0]!.body.length).toBeLessThanOrEqual(500);
  });

  it('en el análisis a fondo no exige un mínimo de consejos', () => {
    expect(parseAdviceList(JSON.stringify([{ ...it1, action: 'Cancela el servicio que menos uses esta semana.' }]), true)).toHaveLength(1);
  });

  it('sin nada utilizable devuelve null', () => {
    for (const t of ['', 'Lo siento, no puedo ayudar con eso.', '[]', '{"error":"x"}', '[1,2,3]', '[{"a":1}]']) expect(parseAdviceList(t, false)).toBeNull();
  });
});
