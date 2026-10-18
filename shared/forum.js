export const forumBoards = [
  {
    id: 'anime',
    name: 'Anime',
    description: 'Seasonal favorites, adaptations, and the next episode.',
    icon: 'Play',
    tone: 'sage',
  },
  {
    id: 'manga',
    name: 'Manga',
    description: 'Panel by panel. Stories, authors, and chapter discussions.',
    icon: 'BookOpen',
    tone: 'gold',
  },
  {
    id: 'manhwa',
    name: 'Manhwa',
    description: 'Webtoons, new chapters, and worlds worth scrolling.',
    icon: 'Layers',
    tone: 'violet',
  },
  {
    id: 'figures',
    name: 'Figures & Collecting',
    description: 'Shelf showcases, new figures, care, and collecting advice.',
    icon: 'Gem',
    tone: 'rose',
  },
  {
    id: 'recommendations',
    name: 'Recommendations',
    description: 'Find your next obsession. Ask for a rec or share a hidden gem.',
    icon: 'Compass',
    tone: 'sage',
  },
  {
    id: 'news',
    name: 'News & Releases',
    description: 'Announcements, adaptations, events, and release news.',
    icon: 'Newspaper',
    tone: 'gold',
  },
  {
    id: 'creations',
    name: 'Fan Creations',
    description: 'Your art, cosplay, writing, and works in progress.',
    icon: 'Palette',
    tone: 'rose',
  },
  {
    id: 'lounge',
    name: 'General Lounge',
    description: 'Introductions, daily chats, and everything between stories.',
    icon: 'Coffee',
    tone: 'violet',
  },
  {
    id: 'feedback',
    name: 'Site Feedback',
    description: 'Ideas, questions, and ways to make Yoru better.',
    icon: 'MessageSquare',
    tone: 'sage',
  },
];
export const forumKinds = ['Discussion', 'Question', 'Theory', 'News', 'Showcase'];
export const forumScope = (value) => (value === 'ara-ara' ? 'ara-ara' : 'yoru');
