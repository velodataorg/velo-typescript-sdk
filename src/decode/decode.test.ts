import { describe, expect, it } from "vitest";
import { z } from "zod";

import { decode } from "./decode.js";
import { number, numberOrNull, timestamp } from "./types.js";

const RowSchema = z.strictObject({
  time: timestamp,
  name: z.string().min(1),
  amount: number,
  value: numberOrNull,
});

type Row = z.output<typeof RowSchema>;

describe("decode", () => {
  it("parses CSV and returns the schema's transformed output", () => {
    const rows: Row[] = decode(
      'time,name,amount,value\r\n1,"one, quoted",2.5,\r\n2,two,3,null\r\n',
      RowSchema,
    );

    expect(rows).toEqual([
      {
        time: 1,
        name: "one, quoted",
        amount: 2.5,
        value: null,
      },
      {
        time: 2,
        name: "two",
        amount: 3,
        value: null,
      },
    ]);
  });

  it("accepts an empty body or an exact header with no rows", () => {
    expect(decode("", RowSchema)).toEqual([]);
    expect(decode("time,name,amount,value\n", RowSchema)).toEqual([]);
  });

  it("requires the exact schema header in the same order", () => {
    const invalid = [
      "time,name,amount\n",
      "time,name,amount,value,extra\n",
      "name,time,amount,value\n",
    ];

    for (const text of invalid) {
      expect(() => decode(text, RowSchema)).toThrow(/CSV header/);
    }
  });

  it("reports row validation failures as Zod errors", () => {
    const invalid = [
      "time,name,amount,value\n-1,test,2,3\n",
      "time,name,amount,value\n1.5,test,2,3\n",
      "time,name,amount,value\n1,,2,3\n",
      "time,name,amount,value\n1,test,,3\n",
      "time,name,amount,value\n1,test,2,NaN\n",
    ];

    for (const text of invalid) {
      expect(() => decode(text, RowSchema)).toThrow(z.ZodError);
    }
  });
});
