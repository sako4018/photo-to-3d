import { useStore } from '../store'
import { useAddPhoto } from '../hooks/useAddPhoto'
import './Home.css'

const TIPS = [
  { title: 'One object, all in frame', text: 'Put the whole object in the picture, with a little space around it.' },
  { title: 'Soft, even light', text: 'Daylight by a window works well. Avoid hard shadows.' },
  { title: 'A little from above', text: 'Shoot from slightly above, not straight on and not from below.' }
]

/** Start screen (H2): drop zone and three tips for a good photo. */
export function Home(): React.JSX.Element {
  const { choose } = useAddPhoto()
  const problem = useStore((state) => state.photoProblem)

  return (
    <div className="home">
      <div className="drop-zone">
        <h1>Drop a photo here</h1>
        <p>
          or{' '}
          <button className="primary" onClick={() => void choose()}>
            Choose a photo…
          </button>
        </p>
        <p className="drop-formats">JPG, PNG, HEIC or WebP, up to 50 MB</p>
        {problem && <p className="drop-status bad">{problem}</p>}
      </div>
      <div className="tips">
        {TIPS.map((tip) => (
          <div key={tip.title} className="tip">
            <strong>{tip.title}</strong>
            <span>{tip.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
