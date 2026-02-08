import type { StorybookConfig } from '@storybook/html-vite'

const config: StorybookConfig = {
  framework: '@storybook/html-vite',
  stories: ['../stories/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-vitest'],
}

export default config
