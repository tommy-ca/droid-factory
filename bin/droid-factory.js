#!/usr/bin/env node
"use strict";

require('../lib/cli').run(process.argv).catch((err) => {
  console.error('Installation failed:', err?.message || err);
  process.exit(1);
});
