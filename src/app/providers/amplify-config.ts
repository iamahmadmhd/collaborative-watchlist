import { Amplify } from 'aws-amplify';
import outputs from '../../../amplify_outputs.json';

// The one frontend file allowed to import the 'aws-amplify' barrel, for the same
// reason CLAUDE.md already grants that exception to amplify/functions/* Lambda
// handlers: Amplify.configure() is exported only from the package root — none of
// aws-amplify/auth, aws-amplify/api, or aws-amplify/utils re-export it (verified
// against the installed version). Every other frontend file still imports
// aws-amplify/auth / aws-amplify/api directly; this is the single place that
// configures the shared singleton those subpaths read from underneath. Imported
// once, for this side effect, at the top of main.tsx — before anything else can
// call an Amplify function.
Amplify.configure(outputs);
