# Portfolio v5 Session Notes
## 24 Jul 2026

### iOS Haptics Fix
`navigator.vibrate()` does NOT work on iOS Safari. Use checkbox toggle hack instead:
- Create hidden checkbox element
- Rapidly toggle `checked` state with rAF
- Triggers Taptic Engine on iOS
- Falls back to `navigator.vibrate()` on Android
- See `src/lib/haptics.ts` in portfolio repo

### Em Dash = AI Tell
User explicitly rejected em dashes in copy: "looks so ai"
- Scan all user-facing text for `—`
- Replace with periods, colons, or rewrite
- Never use em dashes in this user's copy

### Dot Matrix Tuning
Final values after 3 iterations:
- `gap: 7, letterGap: 10, radius: 2.4`
- Radius should be ~30-40% of gap to avoid overlap

### Spring Physics Values Used
| Interaction | Stiffness | Damping | Mass |
|-------------|-----------|---------|------|
| Page transition | 120 | 22 | 1 |
| Nav menu open | 150 | 18 | 1.1 |
| Nav link stagger | 200 | 22 | 0.8 |
| Button tap | 400 | 25 | 0.5 |
