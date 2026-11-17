// OptiManga — page 404

// Importe la fonction d'icône depuis le module des icônes.
import { icon } from "../icons.js";

// Fonction de rendu de la page 404, appelée avec le conteneur de vue.
export function renderNotFound({ viewRoot }) {
  // Ouvre le gabarit HTML de la page 404 (ne rien modifier à l'intérieur).
  viewRoot.innerHTML = `
    <div class="notfound">
      <div class="notfound-glow" aria-hidden="true"></div>
      <span class="notfound-code">404</span>
      <h1>Page introuvable</h1>
      <p>Cette page n'existe pas ou a été déplacée. Reviens à l'accueil pour explorer le catalogue.</p>
      <div class="notfound-actions">
        <a class="btn btn-primary" href="#/">${icon("arrowLeft", 16)} Accueil</a>
        <a class="btn" href="#/catalogue">${icon("search", 16)} Catalogue</a>
      </div>
    </div>`;
  // Ferme la fonction renderNotFound.
}
