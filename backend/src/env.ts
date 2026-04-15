export type NodeEnv = 'development' | 'production' | 'test'

export function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === undefined) return 'development'
  
  switch (value) {
    case 'development':
    case 'production':
    case 'test':
      return value
    default:
      throw new Error(`Invalid NODE_ENV: "${value}".`)
  }
}

export function isProductionEnv(value: string | undefined): boolean {
  return parseNodeEnv(value) === 'production'
}