import { NextResponse } from 'next/server'

const REPO = 'bigbigraydeng-maker/magic-engine'

export async function GET() {
  const token = process.env.GITHUB_TOKEN

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/commits?per_page=25`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'magic-engine-internal',
        },
        // Next.js cache: revalidate every 60s
        next: { revalidate: 60 },
      }
    )

    if (!res.ok) {
      return NextResponse.json(
        { error: `GitHub API returned ${res.status}`, commits: [] },
        { status: 200 } // return 200 so UI still renders
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = await res.json()

    const commits = raw.map((c) => ({
      sha: (c.sha as string).slice(0, 7),
      message: (c.commit.message as string).split('\n')[0],
      author: c.commit.author.name as string,
      date: c.commit.author.date as string,
      url: c.html_url as string,
    }))

    return NextResponse.json({ commits })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch', commits: [] }, { status: 200 })
  }
}
