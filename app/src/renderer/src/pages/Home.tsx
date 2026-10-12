import { useStore } from '../store'
import { useAddPhoto } from '../hooks/useAddPhoto'
import { Icon, type IconName } from '../components/Icon'
import './Home.css'

const TIPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'box', title: 'One object, all in frame', text: 'Put the whole object in the picture, with a little space around it.' },
  { icon: 'sun', title: 'Soft, even light', text: 'Daylight by a window works well. Avoid hard shadows.' },
  { icon: 'image', title: 'A little from above', text: 'Shoot from slightly above, not straight on and not from below.' }
]

/** Start screen (H2): drop zone and three tips for a good photo. */
export function Home(): React.JSX.Element {
  const { choose } = useAddPhoto()
  const problem = useStore((state) => state.photoProblem)

  return (
    <div className="home">
      <div className="drop-zone">
        <span className="drop-icon">
          <Icon name="image" size={28} />
        </span>
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
            <span className="tip-icon">
              <Icon name={tip.icon} size={18} />
            </span>
            <strong>{tip.title}</strong>
            <span>{tip.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
