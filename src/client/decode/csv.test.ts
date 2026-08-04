import { describe, expect, it } from "vitest";
import { z } from "zod";

import { csvBoolean, csvNumber, csvNumberOrNull, csvTimestamp, decode } from "./csv.ts";

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
      'time,name,amount,value,active\r\n1,"one, quoted",2.5,,true\r\n2,two,3,null,false\r\n' +
        "3,three,4,NaN,true\r\n4,four,5,undefined,false\r\n",
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
      {
        time: 3,
        name: "three",
        amount: 4,
        value: null,
        active: true,
      },
      {
        time: 4,
        name: "four",
        amount: 5,
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
      "time,name,amount,value,active\nNaN,test,2,3,true\n",
      "time,name,amount,value,active\n1,,2,3,true\n",
      "time,name,amount,value,active\n1,test,,3,true\n",
      "time,name,amount,value,active\n1,test,NaN,3,true\n",
      "time,name,amount,value,active\n1,test,undefined,3,true\n",
      "time,name,amount,value,active\n1,test, ,3,true\n",
      "time,name,amount,value,active\n1,test,2,Infinity,true\n",
      "time,name,amount,value,active\n1,test,2,-Infinity,true\n",
      "time,name,amount,value,active\n1,test,2, ,true\n",
      "time,name,amount,value,active\n1,test,2,3,TRUE\n",
    ];

    for (const text of invalid) {
      expect(() => decode(text, RowSchema)).toThrow(z.ZodError);
    }
  });

  it("rejects rows with missing cells instead of treating them as null", () => {
    const truncated = [
      "time,name,amount,value,active\n1\n",
      "time,name,amount,value,active\n1,test,2\n",
      "time,name,amount,value,active\n1,test,2.5,,true\n2,two\n",
    ];

    for (const text of truncated) {
      expect(() => decode(text, RowSchema)).toThrow(/CSV row \d+ has \d+ cells, expected 5/);
    }
  });
});
