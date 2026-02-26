# Emergent Hydrogen Orbitals from Quark Rotation Geometry on S³

Three quarks rotate independently through S³ via SU(2) paths with Z₃ cyclic symmetry.
The electron's trajectory is the composed rotation. When weighted by eigenfunctions of the
S³ Laplacian, every hydrogen orbital appears — s, p, d, and f — for all principal quantum
numbers. No Schrödinger equation, no Coulomb potential, no quantum numbers imposed by hand.

## Structure

- `paper/` — LaTeX source for the paper
- `site/` — GitHub Pages site with landing page, PDF viewer, and interactive demo
- `site/demo/` — WebGPU interactive demonstration

## Build

```bash
# Paper
cd paper && pdflatex main && bibtex main && pdflatex main && pdflatex main

# Site (local preview)
cd site && python3 -m http.server 8000
```

## License

CC-BY-4.0
