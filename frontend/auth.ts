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
        token.discordId = (profile as { id: string }).id
        token.avatar = (profile as { avatar: string }).avatar
      }
      return token
    },
    async session({ session, token }) {
      session.user.discordId = token.discordId as string
      session.user.avatar = token.avatar as string
      return session
    },
    async signIn({ profile }) {
      if (profile) {
        try {
          await fetch(`${process.env.NEXTAUTH_URL}/api/v1/me`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET}`,
              'X-Discord-Id': (profile as { id: string }).id,
            },
            body: JSON.stringify({
              discord_id: (profile as { id: string }).id,
              discord_username: profile.name,
              discord_avatar: (profile as { avatar: string }).avatar,
            }),
          })
        } catch {
          // Non-fatal: user upsert failed, still allow sign in
        }
      }
      return true
    },
  },
})
