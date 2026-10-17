import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@trueqr/core"],
  // @trueqr/core uses NodeNext-style "./x.js" imports (so Guardian's tsc can compile it); map them to the .ts sources.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return cfg;
  },
};
export default config;
