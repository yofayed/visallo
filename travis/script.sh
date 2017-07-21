#!/bin/bash

#set -e

if [ "$BUILD_DOCS" ]; then

  # only build if merging into real branch
  if [ "$TRAVIS_PULL_REQUEST" = "false" ]; then

    # Check if this branch should be built as part of documentation
    if [[ $VERSION_LIST =~ (^|[[:space:]])$TRAVIS_BRANCH($|[[:space:]]) ]]; then
      source ~/.nvm/nvm.sh
      VERSION_CURRENT="$TRAVIS_BRANCH" make -C docs link-check-external
    else
      echo "Branch not found in VERSION_LIST for docs, skipping"
      rm -rf docs/_book
    fi
  fi

else

  #~/.m2/repository/node/v6.11.1/node/yarn/dist/bin/yarn remove node-gyp
  #~/.m2/repository/node/v6.11.1/node/yarn/dist/bin/yarn add node-gyp
  #~/.m2/repository/node/v6.11.1/node/yarn/dist/bin/yarn cache clean
  echo "NODE_DIR"
  ls -l $HOME/.m2
  mvn -B -fae compile -Ptest-exclude-native -DlogQuiet
  ~/.m2/repository/node/v6.11.1/node/yarn/dist/bin/yarn global add node-gyp
  ~/.m2/repository/node/v6.11.1/node/yarn/dist/bin/yarn cache clean
  mvn -B -fae compile -Ptest-exclude-native -DlogQuiet
  cat ~/.config/yarn/global/yarn-error.log
  echo "NODE_DIR2"
  ls -l $HOME/.m2
  
  
  #echo ">>>>>"
  #cat $HOME/.config/yarn/global/yarn-error.log
  #echo "<<<<<"
  #mvn -f web -B -fae test -Ptest-exclude-native -DlogQuiet
  #EXIT=$?
  #echo "Exited with $EXIT"
  #echo ">>>>>"
  #cat ~/.config/yarn/global/yarn-error.log
  #echo "<<<<<"  
  #exit $EXIT
  exit 1
fi
