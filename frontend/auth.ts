import NextAuth from 'next-auth'
import Discord from 'next-auth/providers/discord'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) {
        const p = profile as { id: string; username?: string; global_name?: string; avatar?: string }
        token.discordId = p.id
        token.discordUsername = p.username ?? p.global_name ?? token.name ?? p.id
        token.avatar = p.avatar
      }
      return token
    },
    async session({ session, token }) {
      session.user.discordId = token.discordId as string
      session.user.discordUsername = token.discordUsername as string
      session.user.avatar = token.avatar as string
      return session
    },
  },
})
