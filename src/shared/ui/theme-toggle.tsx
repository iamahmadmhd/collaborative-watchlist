import { useThemePreference, type ThemePreference } from '../lib/theme';

// Two visual treatments of the same three-way control: `cards` for desktop Settings and
// `segment` for mobile and the compact corner control on the auth screens. Both drive
// the same store, so the two can never disagree.
//
// The preview swatch colours are hardcoded hex rather than this app's own tokens: a card
// previewing "Light" must still look light while the page around it is dark.
const OPTIONS: { value: ThemePreference; label: string; previewBg: string; bars: [string, string, string] }[] = [
    { value: 'light', label: 'Light', previewBg: '#EAECEF', bars: ['#C5CAD2', '#C5CAD2', '#1B3BD0'] },
    { value: 'dark', label: 'Dark', previewBg: '#131519', bars: ['#2E333D', '#2E333D', '#6B8BFF'] },
    {
        value: 'system',
        label: 'System',
        previewBg: 'linear-gradient(105deg, #EAECEF 0 50%, #131519 50% 100%)',
        bars: ['#9AA3B2', '#9AA3B2', '#6B8BFF'],
    },
];

export function ThemeToggle({ variant, className }: { variant: 'cards' | 'segment'; className?: string }) {
    const [preference, setPreference] = useThemePreference();

    if (variant === 'segment') {
        return (
            <div
                role='radiogroup'
                aria-label='Theme'
                className={`border-border flex overflow-hidden rounded-[3px] border ${className ?? ''}`}
            >
                {OPTIONS.map((option) => {
                    const active = option.value === preference;
                    return (
                        <button
                            key={option.value}
                            type='button'
                            role='radio'
                            aria-checked={active}
                            onClick={() => setPreference(option.value)}
                            className={
                                (active
                                    ? 'bg-accent text-accent-contrast min-h-11 flex-1 px-4 text-sm font-semibold'
                                    : 'text-text min-h-11 flex-1 px-4 text-sm') +
                                ' focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2'
                            }
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        );
    }

    return (
        <div role='radiogroup' aria-label='Theme' className={`grid grid-cols-3 gap-3 ${className ?? ''}`}>
            {OPTIONS.map((option) => {
                const active = option.value === preference;
                return (
                    <button
                        key={option.value}
                        type='button'
                        role='radio'
                        aria-checked={active}
                        onClick={() => setPreference(option.value)}
                        className={`bg-raised focus-visible:outline-accent overflow-hidden rounded-sm border text-left focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? 'border-accent' : 'border-border'}`}
                    >
                        <div
                            className='flex h-19 flex-col justify-center gap-1.5 p-2.75'
                            style={{ background: option.previewBg }}
                        >
                            {option.bars.map((bar, i) => (
                                <div
                                    key={i}
                                    className='h-1.75 rounded-[1px]'
                                    style={{ background: bar, width: i === 0 ? '52%' : i === 1 ? '78%' : '34%' }}
                                />
                            ))}
                        </div>
                        <div className='border-border flex items-center gap-2 border-t px-2.75 py-2.5'>
                            <span
                                className={`h-3.5 w-3.5 flex-none rounded-full border-[1.5px] ${active ? 'border-accent bg-accent' : 'border-border bg-transparent'}`}
                            />
                            <span className={`text-text text-[13px] ${active ? 'font-semibold' : ''}`}>
                                {option.label}
                            </span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
