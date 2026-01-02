module.exports = {
  apps: [
    {
      name: "lingo",
      script: "bun",
      args: "run src/index.ts",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
