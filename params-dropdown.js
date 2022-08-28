function
createParamDropdown             (
root                            ,
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
<select id="pdropdown-${id}">
                                ${
options.map                     ((
x                               ,
i                               ) => `
<option value="${i}">
${x}
</option>
                                `).
join                            (
''                              )}
</select>
                                `
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