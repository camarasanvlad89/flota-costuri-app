// Legătura Preact + htm (fără JSX). Toate fișierele UI importă de aici.
import { h, render, Fragment, createContext, Component, cloneElement } from 'preact';
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export {
  h, render, Fragment, createContext, Component, cloneElement,
  useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer,
};
