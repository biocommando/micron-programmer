function
createParamDropdown             (
root                            ,
label                           ,
options                         ,
onChange
                                ){
createParamDropdown             .
count                           =
createParamDropdown             .
count                           ?
createParamDropdown             .
count                           +
1                               :
1
const
id                              =
createParamDropdown             .
count                           
const
html                            =`
<div class="param-dropdown">
                                ${
label                           }
<br/>
<select id="pdropdown-${id}">
                                ${
options                         .
map                             ((
x                               ,
i                               ) => `
<option value="${i}">
${x}
</option>
                                `).
join                            (
''                              )}
</select>
</div>                          `
root                            .
innerHTML                       +=
html
setTimeout                      (() =>
document                        .
getElementById                  (
'pdropdown-'                    +
id                              ).
addEventListener                (
'change'                        ,
e                               => 
onChange                        (
Number                          (
e                               .
target                          .
value                           ))))
                                }