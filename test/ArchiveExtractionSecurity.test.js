import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

// Hardhat uses extractAllTo when unpacking a verified Windows compiler ZIP.
// The fixture stays entirely inside a disposable directory owned by this test.
const extractors = {
  all: (zip, dest) => zip.extractAllTo(dest, true),
  entry: (zip, dest) => zip.extractEntryTo(zip.getEntries()[0], dest, true, true),
  async: (zip, dest) => new Promise((resolve, reject) => {
    zip.extractAllToAsync(dest, true, false, error => error ? reject(error) : resolve());
  }),
};

describe("compiler ZIP extraction security", function () {
  for (const [api, extract] of Object.entries(extractors)) {
    for (const kind of ["file", "ancestor"]) {
      it(`${api} rejects an existing ${kind} symlink without changing outside files`, async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "solslot-zip-"));
        try {
          const dest = path.join(root, "destination");
          const outside = path.join(root, "outside");
          fs.mkdirSync(dest); fs.mkdirSync(outside);
          const sentinel = path.join(outside, "compiler.exe");
          fs.writeFileSync(sentinel, "unchanged", { mode: 0o600 });
          const entry = kind === "file" ? "compiler.exe" : "bin/compiler.exe";
          const target = kind === "file" ? sentinel : outside;
          const link = path.join(dest, kind === "file" ? "compiler.exe" : "bin");
          fs.symlinkSync(target, link, kind === "file" ? "file" : "junction");
          const zip = new AdmZip(); zip.addFile(entry, Buffer.from("replacement"));
          await assert.rejects(async () => extract(zip, dest));
          assert.equal(fs.readFileSync(sentinel, "utf8"), "unchanged");
          if (process.platform !== "win32") assert.equal(fs.statSync(sentinel).mode & 0o777, 0o600);
          assert.deepEqual(fs.readdirSync(outside), ["compiler.exe"]);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
      });
    }
    it(`${api} extracts an ordinary compiler file and supports intentional overwrite`, async function () {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "solslot-zip-"));
      try {
        const zip = new AdmZip(); zip.addFile("bin/compiler.exe", Buffer.from("compiler"));
        await extract(zip, root);
        assert.equal(fs.readFileSync(path.join(root, "bin/compiler.exe"), "utf8"), "compiler");
        await extract(zip, root);
        assert.equal(fs.readFileSync(path.join(root, "bin/compiler.exe"), "utf8"), "compiler");
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  }
});
