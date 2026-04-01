import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      discordId: string
      avatar: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}
