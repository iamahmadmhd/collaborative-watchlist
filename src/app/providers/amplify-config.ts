import { Amplify } from 'aws-amplify';
import outputs from '../../../amplify_outputs.json';

// The one frontend file allowed to import the 'aws-amplify' barrel: Amplify.configure()
// is exported only from the package root, and no subpath re-exports it. Imported once
// for this side effect at the top of main.tsx, before anything can call Amplify.
Amplify.configure(outputs);
