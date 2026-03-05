import { DISHES } from './catalogData';
import type { Dish } from './types';

export function listCategories(): Dish['category'][] {
  return ['Breakfast', 'Lunch', 'Dinner', 'Dessert'];
}

export function queryDishes(search: string, category: Dish['category'] | 'All'): Dish[] {
  const term = search.trim().toLowerCase();
  return DISHES.filter((dish) => {
    const categoryMatch = category === 'All' || dish.category === category;
    const searchMatch = term.length === 0 || dish.title.toLowerCase().includes(term) || dish.description.toLowerCase().includes(term);
    return categoryMatch && searchMatch;
  });
}

export function getDishById(id: string): Dish | undefined {
  return DISHES.find((d) => d.id === id);
}
