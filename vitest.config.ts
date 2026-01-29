import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: 'jsdom',
                    include: ['packages/agent-bridge/**/*.test.ts', 'packages/core/**/*.test.ts'],
                    environment: 'jsdom',
                }
            },
            {
                test: {
                    name: 'node',
                    include: ['packages/mcp-server/**/*.test.ts', 'packages/schema/**/*.test.ts'],
                    environment: 'node',
                }
            }
        ],
        globals: true,
    },
})
