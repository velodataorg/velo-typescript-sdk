import { describe, expect, it } from "vitest";
import { z } from "zod";

import { csvBoolean, csvNumber, csvNumberOrNull, csvTimestamp, decode } from "./csv.js";

const RowSchema = z.strictObject({
  time: csvTimestamp,
  name: z.string().min(1),
  amount: csvNumber,
  value: csvNumberOrNull,
  active: csvBoolean,
});

type Row = z.output<typeof RowSchema>;

describe("decode", () => {
  it("parses CSV and returns the schema's transformed output", () => {
    const rows: Row[] = decode(
      'time,name,amount,value,active\r\n1,"one, quoted",2.5,,true\r\n2,two,3,null,false\r\n',
      RowSchema,
    );

    expect(rows).toEqual([
      {
        time: 1,
        name: "one, quoted",
        amount: 2.5,
        value: null,
        active: true,
      },
      {
        time: 2,
        name: "two",
        amount: 3,
        value: null,
        active: false,
      },
    ]);
  });

  it("accepts an empty body or an exact header with no rows", () => {
    expect(decode("", RowSchema)).toEqual([]);
    expect(decode("time,name,amount,value,active\n", RowSchema)).toEqual([]);
  });

  it("requires the exact schema header in the same order", () => {
    const invalid = [
      "time,name,amount,value\n",
      "time,name,amount,value,active,extra\n",
      "name,time,amount,value,active\n",
    ];

    for (const text of invalid) {
      expect(() => decode(text, RowSchema)).toThrow(/CSV header/);
    }
  });

  it("reports row validation failures as Zod errors", () => {
    const invalid = [
      "time,name,amount,value,active\n-1,test,2,3,true\n",
      "time,name,amount,value,active\n1.5,test,2,3,true\n",
      "time,name,amount,value,active\n1,,2,3,true\n",
      "time,name,amount,value,active\n1,test,,3,true\n",
      "time,name,amount,value,active\n1,test,2,NaN,true\n",
      "time,name,amount,value,active\n1,test,2,3,TRUE\n",
    ];

    for (const text of invalid) {
      expect(() => decode(text, RowSchema)).toThrow(z.ZodError);
    }
  });
});
