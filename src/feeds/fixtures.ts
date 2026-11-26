// Test fixtures, kept apart so the parse, diff and discovery tests share them. Not imported by the app.

/** The top of https://vitalik.eth.limo/ as served (Nov 2026): no <head>, and the feed link is relative. */
export const VITALIK_HOME = `<!DOCTYPE html>
<html>
<meta charset="UTF-8">



<link rel="alternate" type="application/rss+xml" href="./feed.xml" title="Vitalik Buterin's website">



<link rel="stylesheet" type="text/css" href="./css/main.css">

<div id="doc" class="container-fluid markdown-body comment-enabled" data-hard-breaks="true">
</div>
`;

/** https://vitalik.eth.limo/feed.xml as served (Nov 2026, text/xml): the channel and the first two items, plus a translation dated 2000-01-01. */
export const VITALIK_FEED = `<?xml version="1.0" ?>
<rss version="2.0">
<channel>
  <title>Vitalik Buterin's website</title>
  <link>https://vitalik.ca/</link>
  <description>Vitalik Buterin's website</description>
  <image>
      <url>http://vitalik.ca/images/icon.png</url>
      <title>Vitalik Buterin's website</title>
      <link>https://vitalik.ca/</link>
  </image>

<item>
<title>A shallow dive into open-source chip design</title>
<link>https://vitalik.ca/general/2026/11/26/a_shallow_dive_into_open-source_chip_design.html</link>
<guid>https://vitalik.ca/general/2026/11/26/a_shallow_dive_into_open-source_chip_design.html</guid>
<pubDate>Thu, 26 Nov 2026 00:00:00 +0000</pubDate>
<description></description>
</item>


<item>
<title>Digital minimalism</title>
<link>https://vitalik.ca/general/2026/10/31/digital_minimalism.html</link>
<guid>https://vitalik.ca/general/2026/10/31/digital_minimalism.html</guid>
<pubDate>Sat, 31 Oct 2026 00:00:00 +0000</pubDate>
<description></description>
</item>


<item>
<title>Über Kollusion</title>
<link>https://vitalik.ca/general/2000/01/01/On_Collusion_DE.html</link>
<guid>https://vitalik.ca/general/2000/01/01/On_Collusion_DE.html</guid>
<pubDate>Sat, 01 Jan 2000 00:00:00 +0000</pubDate>
<description></description>
</item>

</channel>
</rss>
`;

export const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Field Notes</title>
  <link rel="self" href="https://notes.example.com/atom.xml"/>
  <link rel="alternate" type="text/html" href="https://notes.example.com/"/>
  <updated>2026-11-20T10:00:00Z</updated>
  <id>tag:notes.example.com,2026:feed</id>
  <entry>
    <title type="html">Tom &amp;amp; Jerry &lt;em&gt;revisited&lt;/em&gt;</title>
    <link rel="alternate" type="text/html" href="/posts/tom-and-jerry"/>
    <link rel="replies" href="/posts/tom-and-jerry/comments.atom"/>
    <id>tag:notes.example.com,2026:tom-and-jerry</id>
    <published>2026-11-20T10:00:00Z</published>
    <updated>2026-11-21T08:30:00Z</updated>
  </entry>
  <entry>
    <title>Updated only</title>
    <link href="https://notes.example.com/posts/updated-only"/>
    <id>tag:notes.example.com,2026:updated-only</id>
    <updated>2026-11-01T09:00:00Z</updated>
  </entry>
  <entry>
    <title>No link, no use</title>
    <id>tag:notes.example.com,2026:no-link</id>
    <updated>2026-10-01T09:00:00Z</updated>
  </entry>
</feed>
`;
