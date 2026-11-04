'use strict';
// Appearance is a device preference; the encrypted vault is never opened here.
(()=>{
  const key='subscription-tracker-theme-v1';
  const themes={
    forest:{name:'Forest & slate',background:'#17211d'},
    sage:{name:'Sage & graphite',background:'#202423'},
    emerald:{name:'Emerald & charcoal',background:'#171c1a'},
    olive:{name:'Olive & stone',background:'#23251f'}
  };
  let selected='forest';
  try{
    const stored=localStorage.getItem(key);
    if(Object.hasOwn(themes,stored))selected=stored;
  }catch{} // A blocked preference store must not prevent the PIN screen loading.
  function apply(theme){
    document.documentElement.dataset.theme=theme;
    document.querySelector('meta[name="theme-color"]').content=themes[theme].background;
  }
  apply(selected); // Apply before the page body paints, including the lock screen.
  document.addEventListener('DOMContentLoaded',()=>{
    const choices=document.querySelectorAll('input[name="theme"]');
    for(const choice of choices){
      choice.checked=choice.value===selected;
      choice.addEventListener('change',()=>{
        if(!choice.checked||!Object.hasOwn(themes,choice.value))return;
        selected=choice.value;
        apply(selected);
        let saved=true;
        try{localStorage.setItem(key,selected)}catch{saved=false}
        document.getElementById('themeStatus').textContent=themes[selected].name+(saved?' selected.':' selected for this session.');
      });
    }
  });
})();
