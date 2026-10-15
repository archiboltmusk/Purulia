/* Look after CRED's NeoPOP (github.com/CRED-CLUB/neopop-web, Apache-2.0): near-black
   ground, sharp corners, 3 px 45° "plunk" edges, caps labels with wide tracking.
   Palette values are NeoPOP's; the components are our own (Pop.tsx). */
export const C = {
  bg: '#0D0D0D',
  card: '#161616',
  raised: '#121212',
  line: '#3D3D3D',
  text: '#FFFFFF',
  dim: '#8A8A8A',
  accent: '#3BFFAD', // parkGreen 500
  accentEdge: '#29B379', // parkGreen 600
  accentDeep: '#1E8057', // parkGreen 700
  ink: '#0D0D0D', // text on light faces
  warn: '#FFCB45', // mannna 500
  bad: '#EE4D37', // error 500
  white: '#FFFFFF',
  whiteEdgeRight: '#E0E0E0',
  whiteEdgeBottom: '#8A8A8A',
  darkEdgeRight: '#3D3D3D',
  darkEdgeBottom: '#161616',
};

export const EDGE = 3;

/* NeoPOP type scale: headings extra-bold with slight tracking, body 1.5 line height,
   caps with 2 px tracking. System fonts (Gilroy and Cirka are licensed fonts). */
export const T = {
  h1: { fontSize: 28, lineHeight: 35, fontWeight: '800', letterSpacing: 0.2 },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: 0.2 },
  h3: { fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: 0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', letterSpacing: 0.4 },
  bodyM: { fontSize: 15, lineHeight: 22, fontWeight: '500', letterSpacing: 0.4 },
  small: { fontSize: 13, lineHeight: 19, fontWeight: '400', letterSpacing: 0.4 },
  caps: { fontSize: 12, lineHeight: 15, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  capsS: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
} as const;
