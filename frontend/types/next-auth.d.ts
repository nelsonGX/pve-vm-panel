import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      discordId: string
      discordUsername: string
      avatar: string | null
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}
