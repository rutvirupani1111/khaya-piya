// Each scene fades up as you walk into it. Opacity only, so fixed sheets and bars stay pinned to the screen.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="scene-in">{children}</div>;
}
