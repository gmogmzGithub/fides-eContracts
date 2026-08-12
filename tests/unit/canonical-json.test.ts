import { describe, expect, it } from "vitest";
import { canonicalizeJson } from "@/lib/canonical-json";

describe("canonicalizeJson con valores primitivos", () => {
  it("serializa null", () => {
    expect(canonicalizeJson(null)).toBe("null");
  });

  it("serializa booleanos", () => {
    expect(canonicalizeJson(true)).toBe("true");
    expect(canonicalizeJson(false)).toBe("false");
  });

  it("serializa cadenas con las secuencias de escape de JSON", () => {
    expect(canonicalizeJson('a"b\n')).toBe('"a\\"b\\n"');
    expect(canonicalizeJson("")).toBe('""');
  });

  it("serializa números enteros, decimales y exponenciales", () => {
    expect(canonicalizeJson(0)).toBe("0");
    expect(canonicalizeJson(-1.5)).toBe("-1.5");
    expect(canonicalizeJson(1e21)).toBe("1e+21");
  });

  it("serializa el cero negativo como cero", () => {
    expect(canonicalizeJson(-0)).toBe("0");
  });
});

describe("canonicalizeJson con arreglos", () => {
  it("conserva el orden del arreglo", () => {
    expect(canonicalizeJson([3, "b", null, true])).toBe('[3,"b",null,true]');
  });

  it("serializa el arreglo vacío", () => {
    expect(canonicalizeJson([])).toBe("[]");
  });

  it("ordena las claves de los objetos anidados en el arreglo", () => {
    expect(canonicalizeJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });
});

describe("canonicalizeJson con objetos", () => {
  it("ordena las claves alfabéticamente", () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("produce la misma cadena sin importar el orden de inserción", () => {
    const uno = canonicalizeJson({ z: 1, a: { y: 2, b: 3 } });
    const dos = canonicalizeJson({ a: { b: 3, y: 2 }, z: 1 });
    expect(uno).toBe(dos);
    expect(uno).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it("ordena las claves como texto, no como número", () => {
    expect(canonicalizeJson({ "10": 5, "2": 6, Z: 4, a: 2, "": 3 })).toBe(
      '{"":3,"10":5,"2":6,"Z":4,"a":2}'
    );
  });

  it("omite las propiedades con valor undefined", () => {
    expect(canonicalizeJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("serializa el objeto vacío", () => {
    expect(canonicalizeJson({})).toBe("{}");
  });

  it("serializa estructuras anidadas y profundas de forma estable", () => {
    const value = {
      contrato: { titulo: "Servicios", clausulas: [{ n: 2 }, { n: 1 }] },
      activo: true,
    };
    expect(canonicalizeJson(value)).toBe(
      '{"activo":true,"contrato":{"clausulas":[{"n":2},{"n":1}],"titulo":"Servicios"}}'
    );
  });

  it("serializa una fecha como objeto vacío porque no tiene claves propias", () => {
    expect(canonicalizeJson(new Date("2026-08-01T00:00:00Z"))).toBe("{}");
  });
});

describe("canonicalizeJson rechaza valores no representables", () => {
  it("rechaza los números no finitos", () => {
    expect(() => canonicalizeJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalizeJson(Number.NaN)).toThrow(
      "Canonical JSON does not allow non-finite numbers."
    );
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalizeJson(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
  });

  it("rechaza undefined en la raíz y dentro de un arreglo", () => {
    expect(() => canonicalizeJson(undefined)).toThrow(
      "Canonical JSON does not allow undefined."
    );
    expect(() => canonicalizeJson([undefined])).toThrow(
      "Canonical JSON does not allow undefined."
    );
  });

  it("rechaza funciones, bigint y símbolos", () => {
    expect(() => canonicalizeJson(() => 1)).toThrow(
      "Canonical JSON does not allow function."
    );
    expect(() => canonicalizeJson(BigInt(10))).toThrow(
      "Canonical JSON does not allow bigint."
    );
    expect(() => canonicalizeJson(Symbol("s"))).toThrow(
      "Canonical JSON does not allow symbol."
    );
  });

  it("propaga el rechazo desde el interior de un objeto anidado", () => {
    expect(() => canonicalizeJson({ a: { b: Number.NaN } })).toThrow(TypeError);
  });
});
